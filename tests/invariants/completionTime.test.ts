/**
 * Invariant tests: patchAttemptByRunId completion time (INV-COMP-1, INV-COMP-2, INV-COMP-3).
 * Wired by test runner in Chunk 2. No runner deps here.
 */

import { patchAttemptByRunId } from "@/lib/requests/runsModel"
import { makeAttempt, makeRuns } from "../fixtures/requestFactory"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const RUN_ID = 12345
const DISPATCHED_AT = "2026-02-01T10:00:00.000Z"
const UPDATED_AT = "2026-02-01T10:05:30.000Z"

export const tests = [
  {
    name: "INV-COMP-1: patchAttemptByRunId sets completedAt = payload.updated_at when status === completed and attempt missing completedAt",
    fn: () => {
      const runs = makeRuns({
        plan: { currentAttempt: 1, attempts: [makeAttempt({ runId: RUN_ID, dispatchedAt: DISPATCHED_AT })] },
      })
      const payload = { status: "completed", conclusion: "success", updated_at: UPDATED_AT }
      const result = patchAttemptByRunId(runs, "plan", RUN_ID, payload)
      assert(result !== null, "expected non-null patch result")
      const attempt = result!.plan.attempts[0]
      assert(attempt.completedAt === UPDATED_AT, `expected completedAt ${UPDATED_AT}, got ${attempt.completedAt}`)
    },
  },
  {
    name: "INV-COMP-2: patchAttemptByRunId MUST NOT clear completedAt once set (payload missing updated_at/completed_at)",
    fn: () => {
      const existingCompletedAt = "2026-02-01T10:04:00.000Z"
      const runs = makeRuns({
        plan: {
          currentAttempt: 1,
          attempts: [
            makeAttempt({
              runId: RUN_ID,
              dispatchedAt: DISPATCHED_AT,
              status: "completed",
              conclusion: "success",
              completedAt: existingCompletedAt,
            }),
          ],
        },
      })
      const payloadNoTime = { status: "completed", conclusion: "success" }
      const result = patchAttemptByRunId(runs, "plan", RUN_ID, payloadNoTime)
      if (result !== null) {
        const attempt = result.plan.attempts[0]
        assert(attempt.completedAt != null, "patch must not clear completedAt")
        assert(attempt.completedAt === existingCompletedAt, `must preserve completedAt: expected ${existingCompletedAt}, got ${attempt.completedAt}`)
      } else {
        assert(runs.plan.attempts[0].completedAt === existingCompletedAt, "noop: original attempt must still have completedAt unchanged")
      }
    },
  },
  {
    name: "INV-COMP-3: patchAttemptByRunId MUST NOT set completedAt when status !== completed",
    fn: () => {
      const runs = makeRuns({
        plan: { currentAttempt: 1, attempts: [makeAttempt({ runId: RUN_ID, dispatchedAt: DISPATCHED_AT })] },
      })
      const payload = { status: "in_progress", updated_at: UPDATED_AT }
      const result = patchAttemptByRunId(runs, "plan", RUN_ID, payload)
      if (result === null) return
      const attempt = result.plan.attempts[0]
      assert(
        attempt.completedAt === undefined,
        `must not set completedAt when status not completed: got ${attempt.completedAt}`
      )
    },
  },
]
