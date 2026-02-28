/**
 * Ops metrics builder: computes KPIs from a bounded list of request documents.
 * Data source: S3 request JSON only. Run state from request.runs (getCurrentAttempt).
 */

import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getCurrentAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"

/** Canonical display statuses for counts (from deriveLifecycleStatus). */
export type DisplayStatus =
  | "request_created"
  | "planning"
  | "plan_ready"
  | "approved"
  | "merged"
  | "applying"
  | "applied"
  | "destroying"
  | "destroyed"
  | "failed"

/** Minimal request-like shape from storage (only fields we need). Run state from runs only. */
export type RequestRow = {
  id?: string
  status?: string
  /** When request was created; some docs may use createdAt. */
  receivedAt?: string
  createdAt?: string
  updatedAt?: string
  statusDerivedAt?: string
  runs?: RunsState
  pr?: { merged?: boolean; open?: boolean }
  approval?: { approved?: boolean }
}

export type OpsMetricsPayload = {
  /** Total requests in the capped list. */
  total: number
  /** Counts by canonical display status. */
  statusCounts: Record<string, number>
  /** Failures: count of requests with status failed in window (by updatedAt). */
  failuresLast24h: number
  failuresLast7d: number
  /** Applies: count of requests with apply success and current attempt dispatchedAt in window. */
  appliesLast24h: number
  appliesLast7d: number
  /** Destroys: count of requests destroyed/destroying with updatedAt in window. */
  destroysLast24h: number
  destroysLast7d: number
  /** Apply duration (seconds). From runs.apply current attempt dispatchedAt → completedAt. */
  avgApplySecondsLast7d: number | null
  p95ApplySecondsLast7d: number | null
  /** created → plan_ready: avg seconds from receivedAt to plan attempt completedAt (7d window). */
  avgCreatedToPlanReadySecondsLast7d: number | null
  /** Apply success rate = applies success / (applies success + apply failures) in 7d. */
  applySuccessRateLast7d: number | null
  /** Plan success rate = plan success / (plan success + plan failures) in 7d. */
  planSuccessRateLast7d: number | null
  /** When this payload was generated (ISO). */
  generatedAt: string
  /** Cache age in seconds (set by route when serving from cache). */
  cacheAgeSeconds?: number
}

const MS_24H = 24 * 60 * 60 * 1000
const MS_7D = 7 * 24 * 60 * 60 * 1000

function inWindow(iso: string | undefined, windowMs: number, now: number): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return !Number.isNaN(t) && now - t <= windowMs
}

function statusForMetrics(row: RequestRow): string {
  return deriveLifecycleStatus(row)
}

/**
 * Build ops metrics from a bounded list of request documents.
 * Cap must be applied by caller (e.g. listRequests(1000)).
 */
export function buildOpsMetrics(requests: RequestRow[], generatedAt: string): OpsMetricsPayload {
  const now = Date.now()
  const statusCounts: Record<string, number> = {}
  const applyDurations7d: number[] = []
  const createdToPlanReadyDurations7d: number[] = []
  let failures24h = 0
  let failures7d = 0
  let applies24h = 0
  let applies7d = 0
  let destroys24h = 0
  let destroys7d = 0
  let applySuccess7d = 0
  let applyFail7d = 0
  let planSuccess7d = 0
  let planFail7d = 0

  for (const row of requests) {
    const status = statusForMetrics(row)
    statusCounts[status] = (statusCounts[status] ?? 0) + 1

    const updatedAt = row.updatedAt || row.statusDerivedAt || row.receivedAt
    const latestApply = getCurrentAttempt(row.runs, "apply")
    const latestPlan = getCurrentAttempt(row.runs, "plan")
    const triggerAt = latestApply?.dispatchedAt
    const completedAt = latestApply?.completedAt

    if (status === "failed") {
      if (inWindow(updatedAt, MS_24H, now)) failures24h += 1
      if (inWindow(updatedAt, MS_7D, now)) failures7d += 1
    }

    if (latestApply?.conclusion === "success" && triggerAt) {
      if (inWindow(triggerAt, MS_24H, now)) applies24h += 1
      if (inWindow(triggerAt, MS_7D, now)) {
        applies7d += 1
        applySuccess7d += 1
        if (completedAt) {
          const start = Date.parse(triggerAt)
          const end = Date.parse(completedAt)
          if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
            applyDurations7d.push(Math.round((end - start) / 1000))
          }
        }
      }
    } else if (latestApply?.conclusion && ["failure", "cancelled", "timed_out"].includes(latestApply.conclusion)) {
      if (inWindow(updatedAt, MS_7D, now)) applyFail7d += 1
    }

    if (status === "destroyed" || status === "destroying") {
      if (inWindow(updatedAt, MS_24H, now)) destroys24h += 1
      if (inWindow(updatedAt, MS_7D, now)) destroys7d += 1
    }

    if (latestPlan?.conclusion === "success" && inWindow(updatedAt, MS_7D, now)) planSuccess7d += 1
    if (latestPlan?.conclusion && ["failure", "cancelled", "timed_out"].includes(latestPlan.conclusion) && inWindow(updatedAt, MS_7D, now)) {
      planFail7d += 1
    }

    const createdAt = row.receivedAt ?? row.createdAt
    if (latestPlan?.conclusion === "success" && latestPlan.completedAt && createdAt && inWindow(latestPlan.completedAt, MS_7D, now)) {
      const start = Date.parse(createdAt)
      const end = Date.parse(latestPlan.completedAt)
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        createdToPlanReadyDurations7d.push(Math.round((end - start) / 1000))
      }
    }
  }

  const total = requests.length
  const sum = applyDurations7d.reduce((a, b) => a + b, 0)
  const avgApplySecondsLast7d = applyDurations7d.length > 0 ? Math.round(sum / applyDurations7d.length) : null
  const sorted = applyDurations7d.slice().sort((a, b) => a - b)
  const p95Idx = sorted.length > 0 ? Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1) : -1
  const p95ApplySecondsLast7d = p95Idx >= 0 ? sorted[p95Idx] : null

  const applyTotal7d = applySuccess7d + applyFail7d
  const applySuccessRateLast7d = applyTotal7d > 0 ? Math.round((applySuccess7d / applyTotal7d) * 1000) / 1000 : null

  const planTotal7d = planSuccess7d + planFail7d
  const planSuccessRateLast7d = planTotal7d > 0 ? Math.round((planSuccess7d / planTotal7d) * 1000) / 1000 : null

  const sumCreatedToPlanReady = createdToPlanReadyDurations7d.reduce((a, b) => a + b, 0)
  const avgCreatedToPlanReadySecondsLast7d =
    createdToPlanReadyDurations7d.length > 0
      ? Math.round(sumCreatedToPlanReady / createdToPlanReadyDurations7d.length)
      : null

  return {
    total,
    statusCounts,
    failuresLast24h: failures24h,
    failuresLast7d: failures7d,
    appliesLast24h: applies24h,
    appliesLast7d: applies7d,
    destroysLast24h: destroys24h,
    destroysLast7d: destroys7d,
    avgApplySecondsLast7d,
    p95ApplySecondsLast7d,
    avgCreatedToPlanReadySecondsLast7d,
    applySuccessRateLast7d,
    planSuccessRateLast7d,
    generatedAt,
  }
}
