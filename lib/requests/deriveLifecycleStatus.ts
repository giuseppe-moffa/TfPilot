/**
 * Unified lifecycle derivation (Lifecycle Model V2).
 * Single entrypoint: status is a pure function of request runtime facts.
 * Reads run state only from request.runs (getCurrentAttemptStrict). Legacy fields are not read.
 *
 * @see docs/LIFECYCLE_MODEL_V2.md
 */

import type { CanonicalStatus } from "@/lib/status/status-config"
import { assertCurrentAttemptExists, getCurrentAttemptStrict, type RunsState } from "@/lib/requests/runsModel"

type PrInfo = {
  merged?: boolean
  headSha?: string
  open?: boolean
}

type ApprovalInfo = {
  approved?: boolean
  approvers?: string[]
}

/** Minimal request shape needed for derivation. Run state from request.runs only. */
export type RequestLike = {
  pr?: PrInfo
  github?: { pr?: PrInfo }
  runs?: RunsState
  approval?: ApprovalInfo
  /** Set by merge route when GitHub merge succeeds; ensures derived status is "merged" immediately. */
  mergedSha?: string
}

/** Minutes after latest destroy attempt dispatchedAt with no conclusion → treat as failed (avoid stuck "destroying"). */
export const DESTROY_STALE_MINUTES = 15

const FAILED_CONCLUSIONS = [
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
] as const

/**
 * Derives canonical lifecycle status from request.runs only (getCurrentAttemptStrict per op).
 * Priority order (V2): destroy → apply/plan failures → apply running/success → merged → approved → plan_ready → planning → request_created.
 */
export function deriveLifecycleStatus(request: RequestLike | null | undefined): CanonicalStatus {
  if (!request) return "request_created"

  const pr = request.github?.pr ?? request.pr
  const runs = request.runs as RunsState | undefined
  assertCurrentAttemptExists(runs, "plan")
  assertCurrentAttemptExists(runs, "apply")
  assertCurrentAttemptExists(runs, "destroy")
  const currentPlan = getCurrentAttemptStrict(runs, "plan")
  const currentApply = getCurrentAttemptStrict(runs, "apply")
  const currentDestroy = getCurrentAttemptStrict(runs, "destroy")
  const { approval } = request

  // 1. Destroy lifecycle
  if (currentDestroy?.conclusion && FAILED_CONCLUSIONS.includes(currentDestroy.conclusion as any)) {
    return "failed"
  }
  if (currentDestroy?.conclusion === "success") {
    return "destroyed"
  }
  // Destroy in-flight: runId present and no conclusion (status-agnostic); stale → failed
  if (
    currentDestroy?.runId != null &&
    (currentDestroy?.conclusion == null || currentDestroy?.conclusion === undefined)
  ) {
    const dispatchedMs = currentDestroy.dispatchedAt ? new Date(currentDestroy.dispatchedAt).getTime() : 0
    if (dispatchedMs && !isNaN(dispatchedMs) && Date.now() - dispatchedMs > DESTROY_STALE_MINUTES * 60 * 1000) {
      return "failed"
    }
    return "destroying"
  }

  // 2. Apply run failed
  if (currentApply?.conclusion && FAILED_CONCLUSIONS.includes(currentApply.conclusion as any)) {
    return "failed"
  }
  // 3. Plan run failed
  if (currentPlan?.conclusion && FAILED_CONCLUSIONS.includes(currentPlan.conclusion as any)) {
    return "failed"
  }
  // 4. Apply in-flight: runId present and no conclusion yet (covers queued, in_progress, unknown, etc.)
  if (
    currentApply?.runId != null &&
    (currentApply?.conclusion == null || currentApply?.conclusion === undefined)
  ) {
    return "applying"
  }
  // 5. Apply success → applied
  if (currentApply?.conclusion === "success") {
    return "applied"
  }
  // 6. PR merged
  if (pr?.merged) return "merged"
  if (request.mergedSha) return "merged"
  // 7. Approval approved
  if (approval?.approved) {
    return "approved"
  }
  // 8. Plan success
  if (currentPlan?.conclusion === "success") {
    return "plan_ready"
  }
  // 9. Plan running
  if (currentPlan?.status === "in_progress" || currentPlan?.status === "queued") {
    return "planning"
  }
  if (pr?.open) {
    return "planning"
  }

  return "request_created"
}

/**
 * True when the current destroy attempt has a failed conclusion.
 * Use in UI for "Destroy failed" state and Retry destroy button.
 */
export function isDestroyRunFailed(request: RequestLike | null | undefined): boolean {
  if (!request?.runs) return false
  const currentDestroy = getCurrentAttemptStrict(request.runs as RunsState, "destroy")
  const conclusion = currentDestroy?.conclusion
  if (!conclusion) return false
  return (FAILED_CONCLUSIONS as readonly string[]).includes(conclusion)
}

/**
 * True when current destroy attempt has runId and no conclusion
 * and more than DESTROY_STALE_MINUTES have passed since dispatchedAt (stale guard).
 */
export function isDestroyRunStale(request: RequestLike | null | undefined): boolean {
  if (!request?.runs) return false
  const currentDestroy = getCurrentAttemptStrict(request.runs as RunsState, "destroy")
  if (currentDestroy?.conclusion != null) return false
  if (currentDestroy?.runId == null) return false
  const dispatchedMs = currentDestroy.dispatchedAt ? new Date(currentDestroy.dispatchedAt).getTime() : NaN
  if (isNaN(dispatchedMs)) return false
  return Date.now() - dispatchedMs > DESTROY_STALE_MINUTES * 60 * 1000
}
