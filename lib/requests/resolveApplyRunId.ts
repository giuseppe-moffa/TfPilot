/**
 * Resolve apply workflow runId after workflow_dispatch.
 *
 * workflow_dispatch does not return runId; we list workflow runs and correlate
 * by created_at >= dispatchTime, branch, and run-index uniqueness so redeploys
 * get the new run and never reuse an old or another request's runId.
 */

import { gh } from "@/lib/github/client"
import { getRequestIdByRunId } from "@/lib/requests/runIndex"
import { logInfo, logWarn } from "@/lib/observability/logger"

const CREATED_AT_TOLERANCE_MS = 5_000

export type ResolveApplyRunIdParams = {
  token: string
  owner: string
  repo: string
  workflowFile: string
  /** Ref we dispatched against (workflow_dispatch body.ref). */
  branch: string
  requestId: string
  dispatchTime: Date
  candidateShas?: Set<string>
  logContext?: Record<string, string | undefined>
}

export type ResolveApplyRunIdResult = { runId: number; url: string } | null

type WorkflowRunRow = {
  id: number
  created_at?: string
  head_sha?: string
  head_branch?: string
  status?: string
  html_url?: string
}

/**
 * List workflow runs and pick the first that:
 * - created_at >= dispatchTime - tolerance
 * - head_branch (when present) matches branch
 * - is not already mapped in run index to a different requestId
 * Returns earliest matching run by created_at.
 */
export async function resolveApplyRunId(
  params: ResolveApplyRunIdParams
): Promise<ResolveApplyRunIdResult> {
  const {
    token,
    owner,
    repo,
    workflowFile,
    branch,
    requestId,
    dispatchTime,
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
      if (Number.isNaN(created) || created < minCreatedTs) return false
      if (r.head_branch != null && r.head_branch !== branch) return false
      return true
    })
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return ta - tb
    })

  for (const run of candidates) {
    const existingRequestId = await getRequestIdByRunId("apply", run.id)
    if (existingRequestId != null && existingRequestId !== requestId) {
      logWarn("resolveApplyRunId.duplicate_runId_skipped", {
        ...logContext,
        requestId,
        runId: run.id,
        alreadyMappedTo: existingRequestId,
      })
      continue
    }
    const url = run.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${run.id}`
    if (process.env.NODE_ENV === "development") {
      logInfo("resolveApplyRunId.resolved", {
        ...logContext,
        requestId,
        runId: run.id,
        created_at: run.created_at,
      })
    }
    return { runId: run.id, url }
  }

  return null
}
