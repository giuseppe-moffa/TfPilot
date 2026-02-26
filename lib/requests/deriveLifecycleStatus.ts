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
  /** Webhook patches write here; prefer over pr when present. */
  github?: {
    pr?: PrInfo
    /** Webhook workflow_run patches; prefer over top-level planRun/applyRun/destroyRun when present. */
    workflows?: {
      plan?: RunInfo
      apply?: RunInfo
      destroy?: RunInfo
      cleanup?: RunInfo
    }
    /** Set when destroy workflow is dispatched; used to timeout stuck "destroying" state. */
    destroyTriggeredAt?: string
  }
  planRun?: RunInfo
  applyRun?: RunInfo
  approval?: ApprovalInfo
  destroyRun?: RunInfo
  /** Set by merge route when GitHub merge succeeds; ensures derived status is "merged" immediately. */
  mergedSha?: string
}

/** Minutes after destroyTriggeredAt with no conclusion → treat as failed (avoid stuck "destroying"). */
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
 * Derives canonical lifecycle status from request runtime facts.
 * Priority order (V2): destroy → apply/plan failures → apply running/success → merged → approved → plan_ready → planning → request_created.
 */
export function deriveLifecycleStatus(request: RequestLike | null | undefined): CanonicalStatus {
  if (!request) return "request_created"

  const pr = request.github?.pr ?? request.pr
  const planRun = request.github?.workflows?.plan ?? request.planRun
  const applyRun = request.github?.workflows?.apply ?? request.applyRun
  const destroyRun = request.github?.workflows?.destroy ?? request.destroyRun
  const { approval } = request

  // 1. Destroy lifecycle: conclusion overrides status; only "destroying" when runId matches and not stale
  if (destroyRun?.conclusion && FAILED_CONCLUSIONS.includes(destroyRun.conclusion as any)) {
    return "failed"
  }
  if (destroyRun?.conclusion === "success") {
    return "destroyed"
  }
  // In-progress/queued with no conclusion: only "destroying" if tracked runId and not timed out
  const destroyTriggeredAt = request.github?.destroyTriggeredAt
  const trackedRunId = destroyRun?.runId
  const statusActive = destroyRun?.status === "in_progress" || destroyRun?.status === "queued"
  if (statusActive && destroyRun?.conclusion == null) {
    if (destroyTriggeredAt && trackedRunId != null) {
      const triggeredMs = new Date(destroyTriggeredAt).getTime()
      if (!isNaN(triggeredMs) && Date.now() - triggeredMs > DESTROY_STALE_MINUTES * 60 * 1000) {
        return "failed"
      }
    }
    return "destroying"
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
  // 6. PR merged (facts: pr.merged or mergedSha from merge route)
  if (pr?.merged) return "merged"
  if (request.mergedSha) return "merged"
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

/**
 * True when the destroy run has a failed conclusion (same source and set as deriveLifecycleStatus).
 * Use in UI for "Destroy failed" state and Retry destroy button.
 */
export function isDestroyRunFailed(request: RequestLike | null | undefined): boolean {
  if (!request) return false
  const destroyRun = request.github?.workflows?.destroy ?? request.destroyRun
  const conclusion = destroyRun?.conclusion
  if (!conclusion) return false
  return (FAILED_CONCLUSIONS as readonly string[]).includes(conclusion)
}

/**
 * True when destroy was triggered (destroyTriggeredAt set), run is still in_progress/queued with no conclusion,
 * and more than DESTROY_STALE_MINUTES have passed. Use in UI to show "Repair" CTA and treat as not actively destroying.
 */
export function isDestroyRunStale(request: RequestLike | null | undefined): boolean {
  if (!request) return false
  const destroyRun = request.github?.workflows?.destroy ?? request.destroyRun
  const destroyTriggeredAt = request.github?.destroyTriggeredAt
  if (!destroyTriggeredAt || destroyRun?.conclusion != null) return false
  const statusActive = destroyRun?.status === "in_progress" || destroyRun?.status === "queued"
  if (!statusActive || destroyRun?.runId == null) return false
  const triggeredMs = new Date(destroyTriggeredAt).getTime()
  if (isNaN(triggeredMs)) return false
  return Date.now() - triggeredMs > DESTROY_STALE_MINUTES * 60 * 1000
}
