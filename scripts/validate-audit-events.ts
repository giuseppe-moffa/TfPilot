/**
 * Validation: buildAuditEvents produces chronological ordering and expected event types.
 * Fixture: plan completed, apply in-flight, destroy completed, lock expired.
 * Run: npm run validate:audit
 */

import { buildAuditEvents, type AuditEvent } from "../lib/requests/auditEvents"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const baseTime = "2025-01-15T10:00:00.000Z"
const lockExpiredAt = "2025-01-15T09:00:00.000Z" // before baseTime so lock is expired at "now"
const nowIso = "2025-01-15T12:00:00.000Z"

const fixtureRequest = {
  id: "req-fixture",
  receivedAt: baseTime,
  createdAt: baseTime,
  updatedAt: "2025-01-15T11:00:00.000Z",
  config: { tags: { "tfpilot:created_by": "creator-user" } },
  targetOwner: "acme",
  targetRepo: "infra",
  approval: { approved: true, approvedAt: "2025-01-15T10:25:00.000Z", approvers: ["alice"] },
  mergedSha: "abc123",
  prNumber: 42,
  pr: { merged: true, mergedAt: "2025-01-15T10:30:00.000Z", mergedBy: "bob", number: 42 },
  runs: {
    plan: {
      currentAttempt: 1,
      attempts: [
        {
          attempt: 1,
          runId: 100,
          url: "https://github.com/acme/infra/actions/runs/100",
          status: "completed" as const,
          conclusion: "success" as const,
          dispatchedAt: "2025-01-15T10:01:00.000Z",
          completedAt: "2025-01-15T10:05:00.000Z",
          headSha: "sha-plan",
          ref: "main",
          actor: "bot",
        },
      ],
    },
    apply: {
      currentAttempt: 1,
      attempts: [
        {
          attempt: 1,
          runId: 101,
          url: "https://github.com/acme/infra/actions/runs/101",
          status: "in_progress" as const,
          dispatchedAt: "2025-01-15T10:10:00.000Z",
          headSha: "sha-apply",
          actor: "bob",
        },
      ],
    },
    destroy: {
      currentAttempt: 1,
      attempts: [
        {
          attempt: 1,
          runId: 102,
          status: "completed" as const,
          conclusion: "success" as const,
          dispatchedAt: "2025-01-15T10:15:00.000Z",
          completedAt: "2025-01-15T10:20:00.000Z",
        },
      ],
    },
  },
  lock: {
    holder: "sync",
    operation: "apply",
    acquiredAt: "2025-01-15T08:00:00.000Z",
    expiresAt: lockExpiredAt,
  },
}

const events = buildAuditEvents(fixtureRequest, nowIso)

// Chronological order
for (let i = 1; i < events.length; i++) {
  const prev = new Date(events[i - 1].at).getTime()
  const curr = new Date(events[i].at).getTime()
  assert(prev <= curr, `Events must be ordered by at: ${events[i - 1].type} (${events[i - 1].at}) before ${events[i].type} (${events[i].at})`)
}

// Key event types exist
const types = new Set(events.map((e: AuditEvent) => e.type))
assert(types.has("request_created"), "request_created must be present")
const requestCreatedEvt = events.find((e) => e.type === "request_created")
assert(requestCreatedEvt != null && requestCreatedEvt.actor === "creator-user", "request_created has actor from config.tags[tfpilot:created_by]")
assert(types.has("plan_dispatched"), "plan_dispatched must be present")
assert(types.has("plan_succeeded"), "plan attempt completed → plan_succeeded must be present")
assert(types.has("apply_dispatched"), "apply_dispatched must be present")
assert(!types.has("apply_succeeded") && !types.has("apply_failed"), "apply in-flight → no apply completion event")
assert(types.has("destroy_dispatched"), "destroy_dispatched must be present")
assert(types.has("destroy_succeeded"), "destroy attempt completed → destroy_succeeded must be present")
assert(types.has("request_approved"), "request_approved must be present")
assert(types.has("pr_merged"), "pr_merged must be present")
assert(types.has("lock_acquired"), "lock_acquired must be present")
assert(types.has("lock_expired"), "lock with expiresAt in past → lock_expired must be present")

// Plan completion has durationMs
const planSucceeded = events.find((e) => e.type === "plan_succeeded")
assert(planSucceeded != null, "plan_succeeded event exists")
assert(typeof (planSucceeded!.meta.durationMs as number) === "number", "plan_succeeded has durationMs in meta")

// Run IDs and URLs in meta where expected
const planDispatched = events.find((e) => e.type === "plan_dispatched")
assert(planDispatched?.meta.runId === 100, "plan_dispatched has runId")
assert((planDispatched?.meta.url as string)?.includes("actions/runs/100"), "plan_dispatched has url")

// Approved/merged use real timestamps and actors
const approvedEvt = events.find((e) => e.type === "request_approved")
assert(approvedEvt != null && approvedEvt.actor === "alice", "request_approved has actor from approvers")
assert(approvedEvt?.at === "2025-01-15T10:25:00.000Z", "request_approved uses approvedAt")
const mergedEvt = events.find((e) => e.type === "pr_merged")
assert(mergedEvt != null && mergedEvt.actor === "bob", "pr_merged has actor from mergedBy")
assert(mergedEvt?.at === "2025-01-15T10:30:00.000Z", "pr_merged uses mergedAt")

// Missing completedAt fallback: attempt with conclusion but no completedAt still emits completed event
const requestNoCompletedAt = {
  id: "req-no-completed",
  receivedAt: "2025-01-16T10:00:00.000Z",
  updatedAt: "2025-01-16T10:10:00.000Z",
  runs: {
    plan: { currentAttempt: 1, attempts: [] },
    apply: { currentAttempt: 1, attempts: [] },
    destroy: { currentAttempt: 1, attempts: [] },
  },
}
;(requestNoCompletedAt.runs as any).plan.attempts = [
  {
    attempt: 1,
    runId: 200,
    status: "completed" as const,
    conclusion: "success" as const,
    dispatchedAt: "2025-01-16T10:01:00.000Z",
    actor: "ci",
  },
]
const eventsFallback = buildAuditEvents(requestNoCompletedAt)
const planSucceededFallback = eventsFallback.find((e) => e.type === "plan_succeeded")
assert(planSucceededFallback != null, "plan_succeeded emitted when conclusion present but completedAt missing")
assert(planSucceededFallback!.meta.missingCompletedAt === true, "missingCompletedAt flag set")
assert(planSucceededFallback!.at === "2025-01-16T10:01:00.000Z", "at fallback to dispatchedAt")
assert(planSucceededFallback!.actor === "ci", "actor from attempt")

console.log("validate-audit-events: all assertions passed.")
console.log("Event order:", events.map((e) => e.type).join(" → "))
