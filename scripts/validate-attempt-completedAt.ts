/**
 * Validation: patchAttemptByRunId persists completedAt from GitHub run payload.
 * - Completed run with completed_at: completedAt set; duration computable.
 * - Completed run with updated_at only (no completed_at): completedAt = updated_at; duration computable.
 * - In-progress run with updated_at: completedAt not set.
 * Run: npm run validate:attempt-completedAt
 */

import { patchAttemptByRunId, type RunsState } from "../lib/requests/runsModel"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const runId = 12345
const dispatchedAt = "2026-02-01T10:00:00.000Z"
const completedAtFromGh = "2026-02-01T10:05:30.000Z"
const updatedAtFromGh = "2026-02-01T11:05:45.000Z"

const runs: RunsState = {
  plan: { currentAttempt: 0, attempts: [] },
  apply: {
    currentAttempt: 1,
    attempts: [
      {
        attempt: 1,
        runId,
        status: "in_progress",
        dispatchedAt,
        url: "https://github.com/owner/repo/actions/runs/12345",
      },
    ],
  },
  destroy: { currentAttempt: 0, attempts: [] },
}

// --- Test 1: completed_at from payload ---
const applyAttemptBefore = runs.apply.attempts[0]
assert(applyAttemptBefore.runId === runId, "fixture has runId")
assert(applyAttemptBefore.dispatchedAt === dispatchedAt, "fixture has dispatchedAt")
assert(applyAttemptBefore.conclusion == null, "fixture has no conclusion")
assert(applyAttemptBefore.completedAt == null, "fixture has no completedAt")

const ghPayloadWithCompletedAt = {
  status: "completed" as const,
  conclusion: "success" as const,
  completed_at: completedAtFromGh,
}

const patched1 = patchAttemptByRunId(runs, "apply", runId, ghPayloadWithCompletedAt)
assert(patched1 != null, "patch returns non-null when payload has completed_at")

const applyAttemptAfter1 = patched1!.apply.attempts[0]
assert(applyAttemptAfter1.completedAt === completedAtFromGh, "attempt has completedAt from GitHub completed_at")
assert(applyAttemptAfter1.conclusion === "success", "attempt has conclusion")
assert(applyAttemptAfter1.status === "completed", "attempt has status completed")
const durationMs1 =
  applyAttemptAfter1.dispatchedAt && applyAttemptAfter1.completedAt
    ? new Date(applyAttemptAfter1.completedAt).getTime() - new Date(applyAttemptAfter1.dispatchedAt).getTime()
    : null
assert(durationMs1 != null && durationMs1 > 0, "duration computable when both dispatchedAt and completedAt set")

// --- Test 2: completed run with updated_at only (no completed_at) ---
const runs2: RunsState = {
  plan: { currentAttempt: 0, attempts: [] },
  apply: {
    currentAttempt: 1,
    attempts: [
      {
        attempt: 1,
        runId: 99999,
        status: "in_progress",
        dispatchedAt: "2026-02-01T11:00:00.000Z", // before updated_at so duration > 0
        url: "https://github.com/owner/repo/actions/runs/99999",
      },
    ],
  },
  destroy: { currentAttempt: 0, attempts: [] },
}
const ghPayloadUpdatedAtOnly = {
  status: "completed" as const,
  conclusion: "success" as const,
  updated_at: "2026-02-01T11:05:45.000Z", // after dispatchedAt
}
const patched2 = patchAttemptByRunId(runs2, "apply", 99999, ghPayloadUpdatedAtOnly)
assert(patched2 != null, "patch returns non-null when status=completed and updated_at set")
const attempt2 = patched2!.apply.attempts[0]
assert(attempt2.completedAt === updatedAtFromGh, "completedAt set from updated_at when status=completed")
assert(attempt2.dispatchedAt != null && attempt2.completedAt != null, "duration computable")
const durationMs2 =
  new Date(attempt2.completedAt!).getTime() - new Date(attempt2.dispatchedAt!).getTime()
assert(durationMs2 >= 0, "duration non-negative")

// --- Test 3: in-progress run does not set completedAt ---
const runs3: RunsState = {
  plan: { currentAttempt: 0, attempts: [] },
  apply: {
    currentAttempt: 1,
    attempts: [
      {
        attempt: 1,
        runId: 88888,
        status: "queued",
        dispatchedAt: "2026-02-01T12:00:00.000Z",
        url: "https://github.com/owner/repo/actions/runs/88888",
      },
    ],
  },
  destroy: { currentAttempt: 0, attempts: [] },
}
const ghPayloadInProgress = {
  status: "in_progress" as const,
  updated_at: "2026-02-01T12:01:00.000Z",
}
const patched3 = patchAttemptByRunId(runs3, "apply", 88888, ghPayloadInProgress)
assert(patched3 != null, "patch returns non-null for in-progress update")
const attempt3 = patched3!.apply.attempts[0]
assert(attempt3.completedAt == null, "in-progress run does not set completedAt")

console.log("validate-attempt-completedAt: all assertions passed.")
console.log("Test 1 (completed_at): completedAt =", applyAttemptAfter1.completedAt, "durationMs =", durationMs1)
console.log("Test 2 (updated_at only): completedAt =", attempt2.completedAt, "durationMs =", durationMs2)
console.log("Test 3 (in_progress): completedAt =", attempt3.completedAt)
