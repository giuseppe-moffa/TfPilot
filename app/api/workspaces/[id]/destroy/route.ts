/**
 * POST /api/workspaces/:id/destroy — Dispatch destroy with destroy_scope="environment",
 * resolve runId, write index. Archive happens on webhook when run completes successfully.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { githubRequest } from "@/lib/github/rateAware"
import { env } from "@/lib/config/env"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
} from "@/lib/auth/permissions"
import { getProjectByKey } from "@/lib/db/projects"
import { archiveWorkspace, getWorkspaceById, type Workspace } from "@/lib/db/workspaces"
import {
  getEnvDestroyPending,
  putEnvDestroyRunIndex,
  putEnvDestroyPending,
  deleteEnvDestroyPending,
  isPendingStaleByTTL,
} from "@/lib/github/envDestroyRunIndex"
import { resolveEnvDestroyRunId } from "@/lib/github/resolveEnvDestroyRunId"
import { buildEnvDestroyInputs } from "@/lib/github/dispatchEnvDestroy"
import { logInfo, logWarn } from "@/lib/observability/logger"
import { incrementEnvMetric } from "@/lib/observability/metrics"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"

const RESOLVE_ATTEMPTS = 12
const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export type WorkspaceDestroyRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  getGitHubAccessToken: (req: NextRequest) => Promise<string | null>
  getWorkspaceById: (id: string) => Promise<Workspace | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ id: string; orgId: string } | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<import("@/lib/auth/permissions").PermissionContext>
  requireProjectPermission: (
    ctx: import("@/lib/auth/permissions").PermissionContext,
    projectId: string,
    permission: "deploy"
  ) => Promise<unknown>
}

const realDeps: WorkspaceDestroyRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getGitHubAccessToken,
  getWorkspaceById,
  getProjectByKey,
  buildPermissionContext,
  requireProjectPermission,
}

export function makeWorkspaceDestroyPOST(deps: WorkspaceDestroyRouteDeps) {
  return async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id: workspaceId } = await params
    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
    }

    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    if (!session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes

    const token = await deps.getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const wsRow = await deps.getWorkspaceById(workspaceId)
    if (!wsRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (wsRow.org_id !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const project = await deps.getProjectByKey(session.orgId, wsRow.project_key)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const ctx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(ctx, project.id, "deploy")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Destroy not permitted for your role" }, { status: 403 })
      }
      throw e
    }

  if (wsRow.archived_at) {
    return NextResponse.json(
      { ok: true, message: "Workspace already archived", alreadyArchived: true },
      { status: 200 }
    )
  }

  const repo = parseRepoFullName(wsRow.repo_full_name)
  if (!repo) {
    return NextResponse.json({ error: "Invalid repo_full_name" }, { status: 400 })
  }

  const pending = await getEnvDestroyPending(workspaceId)
  if (pending) {
    const fetchRepo = pending.repo || wsRow.repo_full_name
    const [fetchOwner, fetchRepoName] = fetchRepo.split("/")

    if (fetchOwner && fetchRepoName) {
      try {
        const runJson = await githubRequest<{ status?: string; conclusion?: string }>({
          token,
          key: `gh:run:env-destroy-check:${fetchOwner}:${fetchRepoName}:${pending.run_id}`,
          ttlMs: 0,
          bypassCache: true,
          path: `/repos/${fetchOwner}/${fetchRepoName}/actions/runs/${pending.run_id}`,
          context: { route: "workspaces/[id]/destroy", correlationId: workspaceId },
        })
        const status = runJson?.status ?? "unknown"
        const conclusion = runJson?.conclusion

        if (status === "in_progress" || status === "queued") {
          return NextResponse.json(
            { error: "Workspace destroy already in progress", runId: pending.run_id },
            { status: 409 }
          )
        }
        if (status === "completed" && conclusion === "success") {
          await archiveWorkspace(workspaceId)
          await deleteEnvDestroyPending(workspaceId)
          logInfo("workspace.archive", { workspace_id: workspaceId, run_id: pending.run_id, source: "reconcile" })
          incrementEnvMetric("env.destroy.archive", { env_id: workspaceId, run_id: pending.run_id })
          return NextResponse.json({
            ok: true,
            message: "Workspace destroy completed (reconciled from pending run)",
            alreadyArchived: false,
          })
        }
        await deleteEnvDestroyPending(workspaceId)
        logInfo("workspace.destroy.reconcile.recovered", { workspace_id: workspaceId, run_id: pending.run_id, pending_found: true })
        incrementEnvMetric("env.destroy.reconcile.recovered", { env_id: workspaceId })
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
        if (status === 404 || status === 410) {
          if (isPendingStaleByTTL(pending)) {
            await deleteEnvDestroyPending(workspaceId)
            logInfo("workspace.destroy.reconcile.stale", { workspace_id: workspaceId, run_id: pending.run_id, pending_found: true })
            incrementEnvMetric("env.destroy.reconcile.stale", { env_id: workspaceId })
          } else {
            return NextResponse.json(
              { error: "Workspace destroy run not found; pending may be stale. Retry after TTL (2h).", runId: pending.run_id },
              { status: 409 }
            )
          }
        } else {
          await deleteEnvDestroyPending(workspaceId)
        }
      }
      } else {
      if (isPendingStaleByTTL(pending)) {
        await deleteEnvDestroyPending(workspaceId)
        logInfo("workspace.destroy.reconcile.stale", { workspace_id: workspaceId, run_id: pending.run_id, pending_found: true })
        incrementEnvMetric("env.destroy.reconcile.stale", { env_id: workspaceId })
      } else {
        return NextResponse.json(
          { error: "Workspace destroy pending (run not found); retry after TTL (2h).", runId: pending.run_id },
          { status: 409 }
        )
      }
    }
  }

  const branch = env.GITHUB_DEFAULT_BASE_BRANCH ?? "main"

  await gh(token, `/repos/${repo.owner}/${repo.repo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: branch,
      inputs: buildEnvDestroyInputs({
        environment_key: wsRow.workspace_key,
        environment_slug: wsRow.workspace_slug,
        environment_id: workspaceId,
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
      const result = await resolveEnvDestroyRunId({
        token,
        owner: repo.owner,
        repo: repo.repo,
        workflowFile: env.GITHUB_DESTROY_WORKFLOW_FILE,
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
        logWarn("workspace_destroy.resolve_failed", {
          workspaceId,
          attempt: attempt + 1,
          err: String(err),
        })
      }
    }
  }

  if (runId == null) {
    return NextResponse.json(
      {
        ok: true,
        message: "Destroy dispatched; run ID could not be resolved. Check GitHub Actions.",
      },
      { status: 200 }
    )
  }

  await putEnvDestroyRunIndex(runId, workspaceId)
  await putEnvDestroyPending(workspaceId, runId, wsRow.repo_full_name)

  logInfo("workspace.destroy.dispatch", {
    workspace_id: workspaceId,
    run_id: runId,
    workspace_key: wsRow.workspace_key,
    workspace_slug: wsRow.workspace_slug,
  })
  incrementEnvMetric("env.destroy.dispatch", { env_id: workspaceId, run_id: runId })

  writeAuditEvent(auditWriteDeps, {
    org_id: wsRow.org_id,
    actor_login: session.login,
    source: "user",
    event_type: "workspace_destroy_requested",
    entity_type: "workspace",
    entity_id: workspaceId,
    environment_id: workspaceId,
    project_key: wsRow.project_key,
    metadata: { project_key: wsRow.project_key, workspace_slug: wsRow.workspace_slug },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    runId,
    url,
    message: "Workspace destroy dispatched. Archive will occur when the workflow completes successfully.",
  })
  }
}

export const POST = makeWorkspaceDestroyPOST(realDeps)
