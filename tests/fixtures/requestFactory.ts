/**
 * Minimal builders for invariant tests. Only fields required for functions under test.
 * No DB, no GitHub — pure objects.
 */

import type { AttemptRecord, RunOpState, RunsState } from "@/lib/requests/runsModel"

const EMPTY_OP: RunOpState = { currentAttempt: 0, attempts: [] }

/** Minimal attempt for needsReconcile / patchAttemptByRunId tests. */
export function makeAttempt(overrides?: Partial<AttemptRecord>): AttemptRecord {
  return {
    attempt: 1,
    runId: undefined,
    status: "queued",
    dispatchedAt: "2026-02-01T10:00:00.000Z",
    ...overrides,
  }
}

/** Minimal runs (plan/apply/destroy, currentAttempt, attempts[]). */
export function makeRuns(overrides?: Partial<RunsState>): RunsState {
  return {
    plan: { ...EMPTY_OP },
    apply: { ...EMPTY_OP },
    destroy: { ...EMPTY_OP },
    ...overrides,
  }
}

/** Minimal request-like object for buildAuditEvents and similar. */
export function makeRequest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "req-1",
    receivedAt: "2026-02-01T09:00:00.000Z",
    createdAt: "2026-02-01T09:00:00.000Z",
    runs: makeRuns(),
    ...overrides,
  }
}
