/**
 * GET /api/workspaces/:id/drift-latest — Last drift plan run for this workspace.
 * Derived from GitHub workflow runs + drift index (facts-only; no persistent status).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { getWorkspaceById } from "@/lib/db/workspaces"
import { getWorkspaceIdByDriftRunId } from "@/lib/github/workspaceDriftRunIndex"

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

type WorkflowRunRow = {
  id: number
  status?: string
  conclusion?: string | null
  html_url?: string
  created_at?: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
  }

  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const token = await getGitHubAccessToken(req)
  if (!token) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
  }

  const wsRow = await getWorkspaceById(workspaceId)
  if (!wsRow) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }
  if (wsRow.org_id !== session.orgId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const repo = parseRepoFullName(wsRow.repo_full_name)
  if (!repo) {
    return NextResponse.json({ error: "Invalid repo_full_name" }, { status: 400 })
  }

  const path = `/repos/${repo.owner}/${repo.repo}/actions/workflows/${env.GITHUB_DRIFT_PLAN_WORKFLOW_FILE}/runs?per_page=30`
  const res = await gh(token, path)
  const data = (await res.json()) as { workflow_runs?: WorkflowRunRow[] }
  const runs = data.workflow_runs ?? []

  for (const run of runs) {
    const indexedId = await getWorkspaceIdByDriftRunId(run.id)
    if (indexedId === workspaceId) {
      return NextResponse.json({
        drift: {
          runId: run.id,
          url: run.html_url ?? `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${run.id}`,
          status: run.status ?? "unknown",
          conclusion: run.conclusion ?? null,
          createdAt: run.created_at ?? null,
        },
      })
    }
  }

  return NextResponse.json({ drift: null })
}
