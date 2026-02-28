/**
 * Regression test: deriveLifecycleStatus derives "applying" / "destroying" from runId + no conclusion
 * (status-agnostic); destroy uses stale guard (past DESTROY_STALE_MINUTES → "failed").
 * Run: npx tsx scripts/validate-derive-status.ts
 */

import { deriveLifecycleStatus, type RequestLike } from "../lib/requests/deriveLifecycleStatus"
import type { RunsState } from "../lib/requests/runsModel"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const now = new Date().toISOString()

function makeRequest(overrides: Partial<RequestLike> & { runs: RunsState }): RequestLike {
  return {
    approval: {},
    ...overrides,
  }
}

// Minimal runs: plan/destroy empty, apply with one attempt
function applyAttempt(attempt: {
  runId?: number
  status: string
  conclusion?: string | null
  dispatchedAt?: string
}) {
  return {
    plan: { currentAttempt: 0, attempts: [] },
    apply: {
      currentAttempt: 1,
      attempts: [
        {
          attempt: 1,
          status: attempt.status as "queued" | "in_progress" | "completed" | "unknown",
          dispatchedAt: attempt.dispatchedAt ?? now,
          ...(attempt.runId != null && { runId: attempt.runId }),
          ...(attempt.conclusion !== undefined && { conclusion: attempt.conclusion }),
        },
      ],
    },
    destroy: { currentAttempt: 0, attempts: [] },
  } as RunsState
}

// 1. Apply in-flight (runId + no conclusion) → "applying" even with PR merged and status "unknown"
const stuckUnknownMerged = makeRequest({
  runs: applyAttempt({ runId: 123, status: "unknown", conclusion: undefined }),
  github: { pr: { merged: true } },
  mergedSha: "abc",
})
assert(deriveLifecycleStatus(stuckUnknownMerged) === "applying", "runId + no conclusion + PR merged → applying")

// 2. Apply success → "applied"
const applySuccess = makeRequest({
  runs: applyAttempt({ runId: 123, status: "completed", conclusion: "success" }),
  github: { pr: { merged: true } },
})
assert(deriveLifecycleStatus(applySuccess) === "applied", "conclusion success → applied")

// 3. Apply failed conclusion → "failed"
const applyFailed = makeRequest({
  runs: applyAttempt({ runId: 123, status: "completed", conclusion: "failure" }),
})
assert(deriveLifecycleStatus(applyFailed) === "failed", "conclusion failure → failed")

const applyCancelled = makeRequest({
  runs: applyAttempt({ runId: 123, status: "completed", conclusion: "cancelled" }),
})
assert(deriveLifecycleStatus(applyCancelled) === "failed", "conclusion cancelled → failed")

// 4. Destroy in-flight (runId + no conclusion, status "unknown") → "destroying"
const destroyInProgress = makeRequest({
  runs: {
    ...applyAttempt({ runId: 456, status: "in_progress", conclusion: undefined }),
    destroy: {
      currentAttempt: 1,
      attempts: [
        { attempt: 1, runId: 789, status: "unknown", dispatchedAt: now },
      ],
    },
  } as RunsState,
})
assert(deriveLifecycleStatus(destroyInProgress) === "destroying", "destroy runId + no conclusion (status unknown) → destroying")

// 4b. Destroy stale (runId + no conclusion but dispatchedAt older than threshold) → "failed"
const staleMinutes = 20
const staleDispatchedAt = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()
const destroyStale = makeRequest({
  runs: {
    ...applyAttempt({ runId: 123, status: "completed", conclusion: "success" }),
    destroy: {
      currentAttempt: 1,
      attempts: [
        { attempt: 1, runId: 999, status: "unknown", conclusion: undefined, dispatchedAt: staleDispatchedAt },
      ],
    },
  } as RunsState,
})
assert(deriveLifecycleStatus(destroyStale) === "failed", "destroy stale (runId + no conclusion, past threshold) → failed")

// 5. Destroy success → "destroyed"
const destroySuccess = makeRequest({
  runs: {
    ...applyAttempt({ runId: 123, status: "completed", conclusion: "success" }),
    destroy: {
      currentAttempt: 1,
      attempts: [
        { attempt: 1, runId: 789, status: "completed", conclusion: "success", dispatchedAt: now },
      ],
    },
  } as RunsState,
})
assert(deriveLifecycleStatus(destroySuccess) === "destroyed", "destroy success overrides apply")

// 6. Destroy failed → "failed"
const destroyFailed = makeRequest({
  runs: {
    ...applyAttempt({ runId: 123, status: "completed", conclusion: "success" }),
    destroy: {
      currentAttempt: 1,
      attempts: [
        { attempt: 1, runId: 789, status: "completed", conclusion: "failure", dispatchedAt: now },
      ],
    },
  } as RunsState,
})
assert(deriveLifecycleStatus(destroyFailed) === "failed", "destroy failure overrides apply")

// 7. No runId, no conclusion → fall through to merged (apply not "in-flight")
const noRunIdMerged = makeRequest({
  runs: applyAttempt({ status: "queued", conclusion: undefined }),
  github: { pr: { merged: true } },
})
assert(deriveLifecycleStatus(noRunIdMerged) === "merged", "no runId + merged → merged")

console.log("validate-derive-status: all assertions passed")
process.exit(0)
