/**
 * When to run repair (GitHub calls) in /sync.
 * Conservative: only true when UI would be blocked without fresh facts.
 * Reads run state from request.runs only (getCurrentAttemptStrict).
 */

import { isDestroyRunStale, type RequestLike as DeriveRequestLike } from "@/lib/requests/deriveLifecycleStatus"
import { getCurrentAttemptStrict, type RunsState } from "@/lib/requests/runsModel"

type RequestLike = {
  targetOwner?: string
  targetRepo?: string
  branchName?: string
  mergedSha?: string
  pr?: { number?: number }
  github?: { pr?: { number?: number } }
  runs?: RunsState
}

function hasPr(request: RequestLike): boolean {
  const pr = request.github?.pr ?? request.pr
  return Boolean(pr?.number)
}

function hasPlanRun(request: RequestLike): boolean {
  const attempt = getCurrentAttemptStrict(request.runs, "plan")
  return Boolean(attempt?.runId ?? attempt?.status ?? attempt?.conclusion)
}

function hasApplyRun(request: RequestLike): boolean {
  const attempt = getCurrentAttemptStrict(request.runs, "apply")
  return Boolean(attempt?.runId ?? attempt?.status ?? attempt?.conclusion)
}

function hasDestroyRun(request: RequestLike): boolean {
  const attempt = getCurrentAttemptStrict(request.runs, "destroy")
  return Boolean(attempt?.runId ?? attempt?.status ?? attempt?.conclusion)
}

/**
 * True when critical facts are missing and we have enough context to fetch them (UI would be blocked).
 */
export function needsRepair(request: RequestLike | null | undefined): boolean {
  if (!request?.targetOwner || !request?.targetRepo) return false

  // Destroy stuck in "destroying" (webhook missed completion) -> repair can refresh run status
  if (isDestroyRunStale(request as DeriveRequestLike)) return true

  // PR missing but we have a branch (request was created with branch) -> need PR metadata
  if (!hasPr(request) && request.branchName) return true

  // Has PR or mergedSha but no workflow run facts -> need runs for lifecycle
  const hasPrOrMerged = hasPr(request) || Boolean(request.mergedSha)
  if (hasPrOrMerged) {
    if (!hasPlanRun(request)) return true
    if (!hasApplyRun(request)) return true
    if (!hasDestroyRun(request)) return true
  }

  return false
}
