/**
 * Canonical audit event stream builder. Used by Lifecycle History UI and audit-export.
 * Events are derived from request facts only; single source of truth for ordering and content.
 */

import { isLockExpired } from "@/lib/requests/lock"
import type { AttemptRecord, RunsState } from "@/lib/requests/runsModel"

export type AuditEvent = {
  at: string
  type: string
  actor?: string
  summary: string
  meta: Record<string, unknown>
}

type TimelineEntry = { step?: string; at?: string }
type RequestLike = {
  id?: string
  receivedAt?: string
  createdAt?: string
  updatedAt?: string
  project?: string
  environment?: string
  module?: string
  config?: { tags?: Record<string, unknown> }
  runs?: RunsState
  approval?: { approved?: boolean; approvers?: string[]; approvedAt?: string }
  mergedSha?: string
  prNumber?: number
  targetOwner?: string
  targetRepo?: string
  pr?: { merged?: boolean; mergedAt?: string; mergedBy?: string; number?: number }
  pullRequest?: { mergedAt?: string; mergedBy?: string }
  github?: { pr?: { merged?: boolean; mergedAt?: string; mergedBy?: string; number?: number } }
  timeline?: TimelineEntry[]
  lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string }
}

const CREATED_BY_TAG = "tfpilot:created_by"

/** Priority for tie-break when `at` is equal (lower = earlier). */
const EVENT_PRIORITY: Record<string, number> = {
  request_created: 0,
  lock_acquired: 1,
  lock_expired: 2,
  lock_cleared: 3,
  plan_dispatched: 10,
  plan_succeeded: 11,
  plan_failed: 12,
  request_approved: 20,
  pr_merged: 21,
  apply_dispatched: 30,
  apply_succeeded: 31,
  apply_failed: 32,
  destroy_dispatched: 40,
  destroy_succeeded: 41,
  destroy_failed: 42,
}

function priorityFor(type: string): number {
  return EVENT_PRIORITY[type] ?? 100
}

function add(
  out: AuditEvent[],
  at: string,
  type: string,
  summary: string,
  meta: Record<string, unknown>,
  actor?: string
) {
  if (!at) return
  out.push({ at, type, actor, summary, meta })
}

function addAttemptEvents(
  out: AuditEvent[],
  kind: "plan" | "apply" | "destroy",
  attempts: AttemptRecord[],
  targetOwner?: string,
  targetRepo?: string,
  requestUpdatedAt?: string
) {
  for (const a of attempts) {
    const meta: Record<string, unknown> = {
      kind,
      attempt: a.attempt,
      ...(a.runId != null && { runId: a.runId }),
      ...(a.url != null && { url: a.url }),
      ...(a.ref != null && { ref: a.ref }),
      ...(a.headSha != null && { headSha: a.headSha }),
    }
    add(
      out,
      a.dispatchedAt,
      `${kind}_dispatched`,
      `${kind === "apply" ? "Deploy" : kind === "plan" ? "Plan" : "Destroy"} dispatched`,
      { ...meta },
      a.actor ?? undefined
    )
    const conclusion = a.conclusion ?? null
    if (conclusion != null) {
      const isSuccess = conclusion === "success"
      const eventType =
        kind === "apply"
          ? isSuccess
            ? "apply_succeeded"
            : "apply_failed"
          : kind === "plan"
            ? isSuccess
              ? "plan_succeeded"
              : "plan_failed"
            : isSuccess
              ? "destroy_succeeded"
              : "destroy_failed"
      const summary =
        kind === "apply"
          ? isSuccess
            ? "Deployment succeeded"
            : `Deployment failed (${conclusion})`
          : kind === "plan"
            ? isSuccess
              ? "Plan succeeded"
              : `Plan failed (${conclusion})`
            : isSuccess
              ? "Destroy succeeded"
              : `Destroy failed (${conclusion})`
      const completedAt = a.completedAt ?? null
      const at = completedAt ?? a.dispatchedAt ?? requestUpdatedAt ?? ""
      const missingCompletedAt = completedAt == null
      const durationMs =
        a.dispatchedAt && a.completedAt
          ? new Date(a.completedAt).getTime() - new Date(a.dispatchedAt).getTime()
          : undefined
      add(
        out,
        at,
        eventType,
        summary,
        { ...meta, conclusion, ...(durationMs != null && { durationMs }), ...(missingCompletedAt && { missingCompletedAt: true }) },
        a.actor ?? undefined
      )
    }
  }
}

/** Get first timeline step timestamp for a step name (e.g. "Approved", "Merged"). */
function timelineStepAt(timeline: TimelineEntry[] | undefined, stepName: string): string | undefined {
  if (!Array.isArray(timeline)) return undefined
  const entry = timeline.find((e) => e.step === stepName && e.at)
  return entry?.at
}

/**
 * Build canonical audit events from request facts only. Deterministic ordering:
 * sort by `at`, then by event priority, then by attempt number for workflow events.
 * No "now" timestamps: approved/merged use real timestamps or timeline fallback, else omit.
 */
export function buildAuditEvents(
  request: RequestLike | null | undefined,
  nowIso?: string
): AuditEvent[] {
  const out: AuditEvent[] = []
  if (!request) return out

  const now = nowIso ?? new Date().toISOString()
  const receivedAt = request.receivedAt ?? request.createdAt
  const runs = request.runs
  const pr = request.github?.pr ?? request.pr
  const pullRequest = request.pullRequest
  const timeline = request.timeline

  // Request Created (actor from config.tags["tfpilot:created_by"] when present; meta: project, environment, module, targetRepo)
  if (receivedAt) {
    const createdBy =
      typeof request.config?.tags?.[CREATED_BY_TAG] === "string"
        ? (request.config.tags[CREATED_BY_TAG] as string)
        : undefined
    const targetRepoStr =
      request.targetOwner && request.targetRepo
        ? `${request.targetOwner}/${request.targetRepo}`
        : undefined
    const requestCreatedMeta: Record<string, unknown> = {}
    if (request.project != null) requestCreatedMeta.project = request.project
    if (request.environment != null) requestCreatedMeta.environment = request.environment
    if (request.module != null) requestCreatedMeta.module = request.module
    if (targetRepoStr != null) requestCreatedMeta.targetRepo = targetRepoStr
    add(out, receivedAt, "request_created", "Request created", requestCreatedMeta, createdBy)
  }

  // Plan/Apply/Destroy attempts (completed events even when completedAt missing: use fallback at)
  if (runs) {
    const targetOwner = request.targetOwner
    const targetRepo = request.targetRepo
    addAttemptEvents(out, "plan", runs.plan?.attempts ?? [], targetOwner, targetRepo, request.updatedAt)
    addAttemptEvents(out, "apply", runs.apply?.attempts ?? [], targetOwner, targetRepo, request.updatedAt)
    addAttemptEvents(out, "destroy", runs.destroy?.attempts ?? [], targetOwner, targetRepo, request.updatedAt)
  }

  // Approval: approvedAt, else timeline step "Approved", else omit (no request.updatedAt / now)
  if (request.approval?.approved) {
    const at =
      request.approval.approvedAt ??
      timelineStepAt(timeline, "Approved")
    if (at) {
      const approvers = request.approval.approvers ?? []
      const actor = approvers.length > 0 ? approvers[0] : undefined
      const targetRepoStr =
        request.targetOwner && request.targetRepo
          ? `${request.targetOwner}/${request.targetRepo}`
          : undefined
      const approvalMeta: Record<string, unknown> = { approvers: approvers.length ? approvers : undefined }
      if (request.prNumber != null) approvalMeta.prNumber = request.prNumber
      if (targetRepoStr != null) approvalMeta.targetRepo = targetRepoStr
      add(out, at, "request_approved", "Request approved", approvalMeta, actor)
    }
  }

  // PR merged: pullRequest.mergedAt / pr.mergedAt, else timeline step "Merged", else omit
  const merged = pr?.merged ?? Boolean(request.mergedSha)
  if (merged) {
    const mergedAt =
      pr?.mergedAt ??
      pullRequest?.mergedAt ??
      timelineStepAt(timeline, "Merged")
    if (mergedAt) {
      const mergedBy = pr?.mergedBy ?? pullRequest?.mergedBy ?? undefined
      add(out, mergedAt, "pr_merged", "PR merged", {
        prNumber: request.prNumber ?? pr?.number,
        mergedSha: request.mergedSha ?? undefined,
      }, mergedBy)
    }
  }

  // Lock events
  const lock = request.lock
  if (lock?.acquiredAt) {
    add(
      out,
      lock.acquiredAt,
      "lock_acquired",
      `Lock acquired by ${lock.holder} (${lock.operation})`,
      { holder: lock.holder, operation: lock.operation },
      lock.holder
    )
  }
  if (lock?.expiresAt && isLockExpired(lock, new Date(now))) {
    add(out, lock.expiresAt, "lock_expired", "Lock expired", {
      holder: lock.holder,
      operation: lock.operation,
    })
  }

  // Deterministic sort: by at, then priority, then attempt for workflow events
  out.sort((a, b) => {
    const ta = new Date(a.at).getTime()
    const tb = new Date(b.at).getTime()
    if (ta !== tb) return ta - tb
    const pa = priorityFor(a.type)
    const pb = priorityFor(b.type)
    if (pa !== pb) return pa - pb
    const attemptA = (a.meta.attempt as number) ?? 0
    const attemptB = (b.meta.attempt as number) ?? 0
    return attemptA - attemptB
  })

  return out
}
