/**
 * POST /api/environments/:id/destroy — Dispatch destroy_v2 with destroy_scope="environment",
 * resolve runId, write index. Archive happens on webhook when run completes successfully.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { githubRequest } from "@/lib/github/rateAware"
import { env } from "@/lib/config/env"
import { getUserRole } from "@/lib/auth/roles"
import { archiveEnvironment, getEnvironmentById } from "@/lib/db/environments"
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

const RESOLVE_ATTEMPTS = 12
const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: environmentId } = await params
  if (!environmentId) {
    return NextResponse.json({ error: "environment_id required" }, { status: 400 })
  }

  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const role = getUserRole(session.login)
  if (role !== "admin") {
    return NextResponse.json({ error: "Destroy not permitted for your role" }, { status: 403 })
  }

  const token = await getGitHubAccessToken(req)
  if (!token) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
  }

  const envRow = await getEnvironmentById(environmentId)
  if (!envRow) {
    return NextResponse.json({ error: "Environment not found" }, { status: 404 })
  }

  if (envRow.archived_at) {
    return NextResponse.json(
      { ok: true, message: "Environment already archived", alreadyArchived: true },
      { status: 200 }
    )
  }

  if (envRow.environment_key === "prod" && env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.length > 0) {
    if (!env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.includes(session.login)) {
      return NextResponse.json(
        { error: "You're not allowed to destroy prod environments" },
        { status: 403 }
      )
    }
  }

  const repo = parseRepoFullName(envRow.repo_full_name)
  if (!repo) {
    return NextResponse.json({ error: "Invalid repo_full_name" }, { status: 400 })
  }

  const pending = await getEnvDestroyPending(environmentId)
  if (pending) {
    const fetchRepo = pending.repo || envRow.repo_full_name
    const [fetchOwner, fetchRepoName] = fetchRepo.split("/")

    if (fetchOwner && fetchRepoName) {
      try {
        const runJson = await githubRequest<{ status?: string; conclusion?: string }>({
          token,
          key: `gh:run:env-destroy-check:${fetchOwner}:${fetchRepoName}:${pending.run_id}`,
          ttlMs: 0,
          bypassCache: true,
          path: `/repos/${fetchOwner}/${fetchRepoName}/actions/runs/${pending.run_id}`,
          context: { route: "environments/[id]/destroy", correlationId: environmentId },
        })
        const status = runJson?.status ?? "unknown"
        const conclusion = runJson?.conclusion

        if (status === "in_progress" || status === "queued") {
          return NextResponse.json(
            { error: "Environment destroy already in progress", runId: pending.run_id },
            { status: 409 }
          )
        }
        if (status === "completed" && conclusion === "success") {
          await archiveEnvironment(environmentId)
          await deleteEnvDestroyPending(environmentId)
          logInfo("env.archive", { env_id: environmentId, run_id: pending.run_id, source: "reconcile" })
          incrementEnvMetric("env.destroy.archive", { env_id: environmentId, run_id: pending.run_id })
          return NextResponse.json({
            ok: true,
            message: "Environment destroy completed (reconciled from pending run)",
            alreadyArchived: false,
          })
        }
        await deleteEnvDestroyPending(environmentId)
        logInfo("env.destroy.reconcile.recovered", { env_id: environmentId, run_id: pending.run_id, pending_found: true })
        incrementEnvMetric("env.destroy.reconcile.recovered", { env_id: environmentId })
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
        if (status === 404 || status === 410) {
          if (isPendingStaleByTTL(pending)) {
            await deleteEnvDestroyPending(environmentId)
            logInfo("env.destroy.reconcile.stale", { env_id: environmentId, run_id: pending.run_id, pending_found: true })
            incrementEnvMetric("env.destroy.reconcile.stale", { env_id: environmentId })
          } else {
            return NextResponse.json(
              { error: "Environment destroy run not found; pending may be stale. Retry after TTL (2h).", runId: pending.run_id },
              { status: 409 }
            )
          }
        } else {
          await deleteEnvDestroyPending(environmentId)
        }
      }
      } else {
      if (isPendingStaleByTTL(pending)) {
        await deleteEnvDestroyPending(environmentId)
        logInfo("env.destroy.reconcile.stale", { env_id: environmentId, run_id: pending.run_id, pending_found: true })
        incrementEnvMetric("env.destroy.reconcile.stale", { env_id: environmentId })
      } else {
        return NextResponse.json(
          { error: "Environment destroy pending (run not found); retry after TTL (2h).", runId: pending.run_id },
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
        environment_key: envRow.environment_key,
        environment_slug: envRow.environment_slug,
        environment_id: environmentId,
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
        logWarn("env_destroy.resolve_failed", {
          environmentId,
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

  await putEnvDestroyRunIndex(runId, environmentId)
  await putEnvDestroyPending(environmentId, runId, envRow.repo_full_name)

  logInfo("env.destroy.dispatch", {
    env_id: environmentId,
    run_id: runId,
    environment_key: envRow.environment_key,
    environment_slug: envRow.environment_slug,
  })
  incrementEnvMetric("env.destroy.dispatch", { env_id: environmentId, run_id: runId })

  return NextResponse.json({
    ok: true,
    runId,
    url,
    message: "Environment destroy dispatched. Archive will occur when the workflow completes successfully.",
  })
}
