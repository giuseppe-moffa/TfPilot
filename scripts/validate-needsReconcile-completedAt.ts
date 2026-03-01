/**
 * Validation: needsReconcile returns true when runId set but conclusion or completedAt missing;
 * false when both conclusion and completedAt are set.
 * Run: npm run validate:needsReconcile-completedAt
 */

import { needsReconcile, type AttemptRecord } from "../lib/requests/runsModel"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

// attempt with runId + conclusion set + completedAt missing => needsReconcile true
const withConclusionNoCompletedAt: AttemptRecord = {
  attempt: 1,
  runId: 123,
  status: "completed",
  dispatchedAt: "2026-02-01T10:00:00.000Z",
  conclusion: "success",
  url: "https://example.com/run/123",
}
assert(
  needsReconcile(withConclusionNoCompletedAt) === true,
  "runId + conclusion + no completedAt => needsReconcile true"
)

// attempt with runId + conclusion set + completedAt set => false
const withConclusionAndCompletedAt: AttemptRecord = {
  attempt: 1,
  runId: 124,
  status: "completed",
  dispatchedAt: "2026-02-01T10:00:00.000Z",
  completedAt: "2026-02-01T10:05:00.000Z",
  conclusion: "success",
  url: "https://example.com/run/124",
}
assert(
  needsReconcile(withConclusionAndCompletedAt) === false,
  "runId + conclusion + completedAt => needsReconcile false"
)

// runId missing => false
assert(needsReconcile({ ...withConclusionNoCompletedAt, runId: undefined }) === false, "no runId => false")
assert(needsReconcile(null) === false, "null attempt => false")
assert(needsReconcile(undefined) === false, "undefined attempt => false")

// runId set, no conclusion, no completedAt => true
const inProgress: AttemptRecord = {
  attempt: 1,
  runId: 125,
  status: "in_progress",
  dispatchedAt: "2026-02-01T10:00:00.000Z",
  url: "https://example.com/run/125",
}
assert(needsReconcile(inProgress) === true, "runId only => needsReconcile true")

console.log("validate-needsReconcile-completedAt: all assertions passed")
