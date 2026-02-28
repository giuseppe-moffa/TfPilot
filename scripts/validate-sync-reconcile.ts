/**
 * Regression test: needsReconcile() must treat apply attempts with runId + status "unknown" + no conclusion
 * as eligible for sync, so sync will fetch the run and set terminal fields (fixes stuck "Deploying…").
 * Run: npx tsx scripts/validate-sync-reconcile.ts
 */

import { needsReconcile, type AttemptRecord } from "../lib/requests/runsModel"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const baseAttempt: AttemptRecord = {
  attempt: 1,
  status: "queued",
  dispatchedAt: new Date().toISOString(),
}

// Stuck case: runId present, status "unknown", no conclusion → must be eligible
const stuckUnknown: AttemptRecord = {
  ...baseAttempt,
  runId: 12345,
  status: "unknown",
  conclusion: undefined,
}
assert(needsReconcile(stuckUnknown) === true, "stuck unknown + no conclusion should be eligible")

// Already terminal → not eligible
const completed: AttemptRecord = {
  ...baseAttempt,
  runId: 12345,
  status: "completed",
  conclusion: "success",
  completedAt: new Date().toISOString(),
}
assert(needsReconcile(completed) === false, "completed with conclusion should not be eligible")

// No runId → not eligible
const noRunId: AttemptRecord = { ...baseAttempt, status: "queued" }
assert(needsReconcile(noRunId) === false, "no runId should not be eligible")

// null/undefined → not eligible
assert(needsReconcile(null) === false, "null attempt should not be eligible")
assert(needsReconcile(undefined) === false, "undefined attempt should not be eligible")

console.log("validate-sync-reconcile: all assertions passed")
process.exit(0)
