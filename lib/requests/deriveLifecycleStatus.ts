/**
 * Unified lifecycle derivation (Lifecycle Model V2).
 * Single entrypoint: status is a pure function of request runtime facts.
 * Returns canonical status for use across API, UI, and metrics.
 *
 * @see docs/LIFECYCLE_MODEL_V2.md
 */

import type { CanonicalStatus } from "@/lib/status/status-config"

type RunInfo = {
  status?: string
  conclusion?: string
  runId?: number
  url?: string
  headSha?: string
}

type PrInfo = {
  merged?: boolean
  headSha?: string
  open?: boolean
}

type ApprovalInfo = {
  approved?: boolean
  approvers?: string[]
}

/** Minimal request shape needed for derivation. */
export type RequestLike = {
  pr?: PrInfo
  planRun?: RunInfo
  applyRun?: RunInfo
  approval?: ApprovalInfo
  destroyRun?: RunInfo
}

const FAILED_CONCLUSIONS = [
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
] as const

/**
 * Derives canonical lifecycle status from request runtime facts.
 * Priority order (V2): destroy → apply/plan failures → apply running/success → merged → approved → plan_ready → planning → request_created.
 */
export function deriveLifecycleStatus(request: RequestLike | null | undefined): CanonicalStatus {
  if (!request) return "request_created"

  const { pr, planRun, applyRun, approval, destroyRun } = request

  // 1. Destroy lifecycle (in progress → destroying; success → destroyed; failed → failed)
  if (destroyRun?.status === "in_progress" || destroyRun?.status === "queued") {
    return "destroying"
  }
  if (destroyRun?.conclusion === "success") {
    return "destroyed"
  }
  if (destroyRun?.conclusion && FAILED_CONCLUSIONS.includes(destroyRun.conclusion as any)) {
    return "failed"
  }

  // 2. Apply run failed
  if (applyRun?.conclusion && FAILED_CONCLUSIONS.includes(applyRun.conclusion as any)) {
    return "failed"
  }
  // 3. Plan run failed
  if (planRun?.conclusion && FAILED_CONCLUSIONS.includes(planRun.conclusion as any)) {
    return "failed"
  }
  // 4. Apply running
  if (applyRun?.status === "in_progress" || applyRun?.status === "queued") {
    return "applying"
  }
  // 5. Apply success → applied (canonical; was "complete" in legacy)
  if (applyRun?.conclusion === "success") {
    return "applied"
  }
  // 6. PR merged
  if (pr?.merged) {
    return "merged"
  }
  // 7. Approval approved
  if (approval?.approved) {
    return "approved"
  }
  // 8. Plan success
  if (planRun?.conclusion === "success") {
    return "plan_ready"
  }
  // 9. Plan running
  if (planRun?.status === "in_progress" || planRun?.status === "queued") {
    return "planning"
  }
  // 10. PR open (optional: could map to planning for canonical)
  if (pr?.open) {
    return "planning"
  }

  return "request_created"
}
