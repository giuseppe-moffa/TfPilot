/**
 * POST /api/github/drift-plan — Dispatch drift_plan for a workspace.
 * Resolves runId and writes env drift index for last-drift display.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { getWorkspaceById } from "@/lib/db/workspaces"
import { buildDriftPlanInputs } from "@/lib/github/dispatchDriftPlan"
import { putWorkspaceDriftRunIndex } from "@/lib/github/workspaceDriftRunIndex"
import { resolveWorkspaceDriftRunId } from "@/lib/github/resolveWorkspaceDriftRunId"
import { logInfo, logWarn } from "@/lib/observability/logger"

const RESOLVE_ATTEMPTS = 12
const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const workspaceId = body?.workspace_id
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
  }

  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const token = await getGitHubAccessToken(req)
  if (!token) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
  }

  const wsRow = await getWorkspaceById(workspaceId)
  if (!wsRow) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  if (wsRow.archived_at) {
    return NextResponse.json({ error: "Workspace is archived" }, { status: 400 })
  }

  const repo = parseRepoFullName(wsRow.repo_full_name)
  if (!repo) {
    return NextResponse.json({ error: "Invalid repo_full_name" }, { status: 400 })
  }

  const branch = env.GITHUB_DEFAULT_BASE_BRANCH ?? "main"

  await gh(token, `/repos/${repo.owner}/${repo.repo}/actions/workflows/${env.GITHUB_DRIFT_PLAN_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: branch,
      inputs: buildDriftPlanInputs({
        environment_key: wsRow.workspace_key,
        environment_slug: wsRow.workspace_slug,
      }),
    }),
  })

  const dispatchTime = new Date()

  let runId: number | undefined
  let url: string | undefined

  for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]))
    }
    try {
      const result = await resolveWorkspaceDriftRunId({
        token,
        owner: repo.owner,
        repo: repo.repo,
        workflowFile: env.GITHUB_DRIFT_PLAN_WORKFLOW_FILE,
        branch,
        dispatchTime,
      })
      if (result) {
        runId = result.runId
        url = result.url
        break
      }
    } catch (err) {
      if (attempt === RESOLVE_ATTEMPTS - 1) {
        logWarn("workspace_drift.resolve_failed", {
          workspaceId,
          attempt: attempt + 1,
          err: String(err),
        })
      }
    }
  }

  if (runId != null) {
    await putWorkspaceDriftRunIndex(runId, workspaceId).catch(() => {})
    logInfo("workspace.drift.dispatch", {
      workspace_id: workspaceId,
      run_id: runId,
      workspace_key: wsRow.workspace_key,
      workspace_slug: wsRow.workspace_slug,
    })
  }

  return NextResponse.json({
    ok: true,
    runId: runId ?? null,
    url: url ?? null,
    message: runId != null
      ? "Drift plan dispatched. Check GitHub Actions for results."
      : "Drift plan dispatched; run ID could not be resolved. Check GitHub Actions.",
  })
}
