/**
 * Canonical run model: request.runs.{plan,apply,destroy} with attempts.
 * Chunk 1: dual-write only; readers continue using legacy fields.
 */

export type AttemptRecord = {
  attempt: number
  /** Set when GitHub run is known; may be missing right after dispatch until runs list or webhook provides it. */
  runId?: number
  url?: string
  status: "queued" | "in_progress" | "completed" | "unknown"
  conclusion?: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | null
  dispatchedAt: string
  completedAt?: string
  headSha?: string
  ref?: string
  actor?: string
}

export type RunOpState = {
  /** Only incremented during dispatch (persistDispatchAttempt). Webhook/sync must NEVER change it. */
  currentAttempt: number
  attempts: AttemptRecord[]
}

export type RunsState = {
  plan: RunOpState
  apply: RunOpState
  destroy: RunOpState
}

const EMPTY_OP: RunOpState = { currentAttempt: 0, attempts: [] }

export const EMPTY_RUNS: RunsState = {
  plan: { ...EMPTY_OP },
  apply: { ...EMPTY_OP },
  destroy: { ...EMPTY_OP },
}

/**
 * Ensure request has runs.plan, runs.apply, runs.destroy with { currentAttempt: 0, attempts: [] } if missing.
 * Mutates request in place.
 */
export function ensureRuns(request: Record<string, unknown>): void {
  const r = request as { runs?: Partial<RunsState> }
  if (!r.runs || typeof r.runs !== "object") {
    r.runs = { ...EMPTY_RUNS }
  }
  const runs = r.runs
  if (!runs.plan || !Array.isArray(runs.plan.attempts)) {
    runs.plan = { currentAttempt: 0, attempts: [] }
  }
  if (!runs.apply || !Array.isArray(runs.apply.attempts)) {
    runs.apply = { currentAttempt: 0, attempts: [] }
  }
  if (!runs.destroy || !Array.isArray(runs.destroy.attempts)) {
    runs.destroy = { currentAttempt: 0, attempts: [] }
  }
}

export type RunKind = "plan" | "apply" | "destroy"

export type DispatchRunMeta = {
  runId?: number
  url?: string
  actor?: string
  headSha?: string
  ref?: string
}

/**
 * Build the runs patch for a new dispatch attempt: ensureRuns, increment currentAttempt, append attempt record.
 * Call immediately after workflow dispatch even when runId is not yet known (GitHub runs list eventually consistent).
 * This is the ONLY place that may set runs[kind].currentAttempt. Webhook/sync must NEVER change currentAttempt.
 * Returns { runs, updatedAt } to merge into the request in updateRequest. Does not mutate request (call ensureRuns before if you need request.runs to exist).
 */
export function persistDispatchAttempt(
  current: Record<string, unknown>,
  kind: RunKind,
  runMeta: DispatchRunMeta
): { runs: RunsState; updatedAt: string } {
  ensureRuns(current)
  const runs = { ...(current.runs as RunsState) }
  const op = runs[kind]
  const nextAttempt = (op.currentAttempt ?? 0) + 1
  const nowIso = new Date().toISOString()
  const record: AttemptRecord = {
    attempt: nextAttempt,
    status: "queued",
    dispatchedAt: nowIso,
    ...(runMeta.runId != null && { runId: runMeta.runId }),
    ...(runMeta.url != null && { url: runMeta.url }),
    ...(runMeta.actor != null && { actor: runMeta.actor }),
    ...(runMeta.headSha != null && { headSha: runMeta.headSha }),
    ...(runMeta.ref != null && { ref: runMeta.ref }),
  }
  runs[kind] = {
    currentAttempt: nextAttempt,
    attempts: [...(op.attempts ?? []), record],
  }
  return { runs, updatedAt: nowIso }
}

/** Map GitHub API run status to our AttemptRecord status. */
function mapGhStatus(gh: string | undefined): AttemptRecord["status"] {
  if (gh === "queued" || gh === "in_progress" || gh === "completed") return gh
  return "unknown"
}

/** Return non-empty trimmed string or undefined. */
function nonEmpty(s: string | undefined | null): string | undefined {
  const t = typeof s === "string" ? s.trim() : ""
  return t || undefined
}

/**
 * Attach runId/url to an existing attempt by attempt number (e.g. after GitHub runs list returns).
 * Only updates the matching attempt; does not change currentAttempt. If the attempt already has runId and it differs, logs warning and no-op.
 * Returns updated runs or null if attempt not found or no change.
 */
export function patchAttemptRunId(
  runs: RunsState,
  kind: RunKind,
  attemptNumber: number,
  meta: { runId: number; url?: string }
): RunsState | null {
  const op = runs[kind]
  const idx = op?.attempts?.findIndex((a) => a.attempt === attemptNumber) ?? -1
  if (idx < 0) return null
  const existing = op.attempts[idx]
  if (existing.runId != null && existing.runId !== meta.runId) {
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      console.warn(
        "[runsModel] patchAttemptRunId: attempt already has runId, skipping",
        { kind, attemptNumber, existingRunId: existing.runId, incomingRunId: meta.runId }
      )
    }
    return null
  }
  if (existing.runId === meta.runId && existing.url === meta.url) return null
  const next: AttemptRecord = {
    ...existing,
    runId: meta.runId,
    ...(meta.url != null && { url: meta.url }),
  }
  const attempts = [...op.attempts]
  attempts[idx] = next
  return { ...runs, [kind]: { ...op, attempts } }
}

/**
 * Patch a single attempt in runs[kind].attempts by runId from GitHub run payload.
 * Does NOT modify runs[kind].currentAttempt (preserves op; only updates the matching attempt in attempts[]).
 * Completion time: single-source — if existing.completedAt set keep it; else when status=completed
 * use gh.completed_at ?? gh.updated_at (GitHub run API has updated_at, not completed_at). Never clear completedAt.
 * Monotonic: no regression from completed → in_progress/queued; don't clear conclusion.
 * Returns updated runs or null if attempt not found or no change.
 */
export function patchAttemptByRunId(
  runs: RunsState,
  kind: RunKind,
  runId: number,
  gh: {
    status?: string
    conclusion?: string | null
    completed_at?: string
    updated_at?: string
    head_sha?: string
  }
): RunsState | null {
  const op = runs[kind]
  const idx = op?.attempts?.findIndex((a) => a.runId === runId) ?? -1
  if (idx < 0) return null
  const existing = op.attempts[idx]
  const status = mapGhStatus(gh.status)
  const conclusion = gh.conclusion ?? undefined
  const headSha = gh.head_sha ?? existing.headSha

  // Monotonic: don't overwrite completed with in_progress/queued
  if (existing.status === "completed" && (status === "in_progress" || status === "queued")) {
    return null
  }
  // Monotonic: don't clear conclusion
  if (existing.conclusion != null && conclusion == null) {
    return null
  }
  // Single-source completion time: keep existing; else when status=completed use completed_at ?? updated_at (GitHub run has updated_at)
  const finalCompletedAt =
    existing.completedAt ??
    (gh.status === "completed" ? (nonEmpty(gh.completed_at) ?? nonEmpty(gh.updated_at)) : undefined)

  if (process.env.DEBUG_WEBHOOKS === "1") {
    console.log("event=runsModel.patch_completed_at", {
      kind,
      runId,
      updated_at: gh.updated_at ?? null,
      finalCompletedAt: finalCompletedAt ?? null,
    })
  }

  const next: AttemptRecord = {
    ...existing,
    status,
    ...(conclusion != null && { conclusion: conclusion as AttemptRecord["conclusion"] }),
    ...(finalCompletedAt != null && finalCompletedAt !== "" && { completedAt: finalCompletedAt }),
    ...(headSha != null && { headSha }),
  }
  if (
    existing.status === next.status &&
    existing.conclusion === next.conclusion &&
    existing.completedAt === next.completedAt
  ) {
    return null
  }
  const attempts = [...op.attempts]
  attempts[idx] = next
  return { ...runs, [kind]: { ...op, attempts } }
}

/**
 * In development only: assert that when currentAttempt > 0, a matching attempt record exists.
 * Logs an error if currentAttempt is set but no attempt with that number exists (silent corruption).
 */
export function assertCurrentAttemptExists(
  runs: RunsState | null | undefined,
  kind: RunKind
): void {
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") return
  if (!runs?.[kind]) return
  const op = runs[kind]
  const current = op.currentAttempt ?? 0
  if (current === 0) return
  const found = op.attempts?.some((a) => a.attempt === current)
  if (!found) {
    console.error("[runsModel] invariant: currentAttempt exists but no matching attempt record", {
      kind,
      currentAttempt: current,
      attemptNumbers: op.attempts?.map((a) => a.attempt) ?? [],
    })
  }
}

/**
 * Return the current attempt for an op (attempt where attempt === currentAttempt).
 * Use for UI and lifecycle derivation. Returns null if no current attempt.
 */
export function getCurrentAttempt(runs: RunsState | null | undefined, kind: RunKind): AttemptRecord | null {
  if (!runs?.[kind]?.attempts?.length) return null
  const op = runs[kind]
  const current = op.currentAttempt ?? 0
  const record = op.attempts.find((a) => a.attempt === current)
  return record ?? null
}

/**
 * Authoritative current attempt only: the attempt whose attempt === runs[kind].currentAttempt.
 * No fallback to last element or "latest by time". Use for status derivation, gating, retry, locks.
 * Returns null if currentAttempt is 0 or no matching attempt exists.
 */
export function getCurrentAttemptStrict(runs: RunsState | null | undefined, kind: RunKind): AttemptRecord | null {
  if (!runs?.[kind]) return null
  const op = runs[kind]
  const current = op.currentAttempt ?? 0
  if (current === 0) return null
  const record = op.attempts?.find((a) => a.attempt === current) ?? null
  return record ?? null
}

/**
 * True if the attempt is active (queued or in progress). Use for "is running" gating.
 */
export function isAttemptActive(attempt: AttemptRecord | null | undefined): boolean {
  if (!attempt) return false
  return attempt.status === "queued" || attempt.status === "in_progress"
}

/**
 * True when the attempt needs reconciliation: we have a runId but are missing a terminal field
 * (conclusion or completedAt). Use for sync: fetch run from GitHub and patch
 * status/conclusion/completedAt/headSha. Allows backfilling completedAt when conclusion
 * was set without completed_at from the payload.
 */
export function needsReconcile(attempt: AttemptRecord | null | undefined): boolean {
  if (!attempt) return false
  return (
    attempt.runId != null &&
    (attempt.conclusion == null || attempt.conclusion === undefined || attempt.completedAt == null)
  )
}

/**
 * Find which op and attempt record has the given runId (for output routes / lookup by runId).
 */
export function getAttemptByRunId(
  runs: RunsState | null | undefined,
  runId: number
): { kind: RunKind; attempt: AttemptRecord } | null {
  if (!runs) return null
  for (const kind of (["plan", "apply", "destroy"] as const)) {
    const record = runs[kind]?.attempts?.find((a) => a.runId === runId)
    if (record) return { kind, attempt: record }
  }
  return null
}
