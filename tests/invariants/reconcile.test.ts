/**
 * Invariant tests: needsReconcile (INV-REC-1).
 * Wired by test runner in Chunk 2. No runner deps here.
 */

import { needsReconcile } from "@/lib/requests/runsModel"
import { makeAttempt } from "../fixtures/requestFactory"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "INV-REC-1: needsReconcile returns TRUE when runId set and conclusion missing",
    fn: () => {
      const attempt = makeAttempt({ runId: 12345 })
      assert(needsReconcile(attempt) === true, "expected true when runId set and conclusion missing")
    },
  },
  {
    name: "INV-REC-1: needsReconcile returns TRUE when runId set, conclusion present, completedAt missing",
    fn: () => {
      const attempt = makeAttempt({ runId: 12345, conclusion: "success" })
      assert(needsReconcile(attempt) === true, "expected true when conclusion present but completedAt missing")
    },
  },
  {
    name: "INV-REC-1: needsReconcile returns FALSE when runId set, conclusion present, completedAt present",
    fn: () => {
      const attempt = makeAttempt({
        runId: 12345,
        conclusion: "success",
        completedAt: "2026-02-01T10:05:00.000Z",
      })
      assert(needsReconcile(attempt) === false, "expected false when conclusion and completedAt both present")
    },
  },
]
