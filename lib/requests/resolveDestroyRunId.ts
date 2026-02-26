/**
 * Resolve destroy workflow runId after workflow_dispatch.
 *
 * Why runId resolution is needed: GitHub's workflow_dispatch API does not return
 * the new run's id; we must list workflow runs and correlate. Without strict
 * constraints (created_at >= dispatchTime, branch, run-index uniqueness),
 * back-to-back destroys in the same env can both attribute the same "latest"
 * run and end up with the same runId, leaving both stuck as "destroying".
 *
 * Uniqueness check: Before assigning a runId to this request we check the S3
 * run index. If that runId is already mapped to another requestId we skip it
 * and try the next candidate so no two requests ever share a destroy runId.
 */

import { gh } from "@/lib/github/client"
import { getRequestIdByRunId } from "@/lib/requests/runIndex"
import { logInfo, logWarn } from "@/lib/observability/logger"

const CREATED_AT_TOLERANCE_MS = 5_000 // allow runs created up to 5s before dispatch (clock skew / listing delay)

export type ResolveDestroyRunIdParams = {
  token: string
  owner: string
  repo: string
  workflowFile: string
  /** Ref we dispatched against (same as workflow_dispatch body.ref). Not the repo default base — the actual branch used for this dispatch. */
  branch: string
  requestId: string
  /** Dispatch time; we only consider runs created at or after this (minus tolerance). */
  dispatchTime: Date
  /** Optional: prefer runs whose head_sha is in this set (e.g. mergedSha, commitSha). */
  candidateShas?: Set<string>
  /** Optional: run name / display_title may contain requestId or branch for correlation. */
  requestIdForName?: string
  /** Log context (route, correlationId). */
  logContext?: Record<string, string | undefined>
}

export type ResolveDestroyRunIdResult = { runId: number; url: string } | null

type WorkflowRunRow = {
  id: number
  created_at?: string
  head_sha?: string
  head_branch?: string
  name?: string
  status?: string
  html_url?: string
}

/**
 * List workflow runs from GitHub (no cache) and pick the first run that:
 * - created_at >= dispatchTime - tolerance
 * - head_branch (when present) matches the ref we dispatched against; when null/omitted we allow the run
 * - is not already mapped in the run index to a different requestId
 * If multiple candidates pass, returns the one with earliest created_at after dispatch.
 */
export async function resolveDestroyRunId(
  params: ResolveDestroyRunIdParams
): Promise<ResolveDestroyRunIdResult> {
  const {
    token,
    owner,
    repo,
    workflowFile,
    branch,
    requestId,
    dispatchTime,
    candidateShas,
    logContext = {},
  } = params

  const path = `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?branch=${encodeURIComponent(
    branch
  )}&per_page=30`
  const res = await gh(token, path)
  const data = (await res.json()) as { workflow_runs?: WorkflowRunRow[] }
  const runs = data.workflow_runs ?? []

  const dispatchTs = dispatchTime.getTime()
  const minCreatedTs = dispatchTs - CREATED_AT_TOLERANCE_MS

  const candidates = runs
    .filter((r) => {
      const created = r.created_at ? Date.parse(r.created_at) : NaN
      if (Number.isNaN(created) || created < minCreatedTs) {
        if (process.env.NODE_ENV === "development" && r.id) {
          logInfo("resolveDestroyRunId.rejected", {
            ...logContext,
            runId: r.id,
            reason: created < minCreatedTs ? "created_before_dispatch" : "no_created_at",
            created_at: r.created_at,
            dispatchTime: dispatchTime.toISOString(),
          })
        }
        return false
      }
      // Only reject when head_branch is present and differs. When null/omitted (some triggers omit it) we allow the run; dispatchTime filtering still applies.
      if (r.head_branch != null && r.head_branch !== branch) {
        if (process.env.NODE_ENV === "development" && r.id) {
          logInfo("resolveDestroyRunId.rejected", {
            ...logContext,
            runId: r.id,
            reason: "head_branch_mismatch",
            head_branch: r.head_branch,
            expectedBranch: branch,
          })
        }
        return false
      }
      return true
    })
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return ta - tb
    })

  for (const run of candidates) {
    const existingRequestId = await getRequestIdByRunId("destroy", run.id)
    if (existingRequestId != null && existingRequestId !== requestId) {
      logWarn("resolveDestroyRunId.duplicate_runId_skipped", {
        ...logContext,
        requestId,
        runId: run.id,
        alreadyMappedTo: existingRequestId,
      })
      continue
    }
    const url = run.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${run.id}`
    if (process.env.NODE_ENV === "development") {
      logInfo("resolveDestroyRunId.resolved", {
        ...logContext,
        requestId,
        runId: run.id,
        created_at: run.created_at,
        head_sha: run.head_sha,
        candidateShasMatch: run.head_sha && candidateShas?.has(run.head_sha),
      })
    }
    return { runId: run.id, url }
  }

  return null
}
