import type { NextRequest } from "next/server"

/** Idempotency window: 10 minutes. */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000

const HEADER = "x-idempotency-key"
const KEY_MAX_LENGTH = 512

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly operation: string
  ) {
    super(message)
    this.name = "ConflictError"
  }
}

export type AssertResult =
  | { ok: true; mode: "no_key" }
  | { ok: false; mode: "replay" }
  | { ok: true; mode: "recorded"; patch: { idempotency: Record<string, { key: string; at: string }> } }

export type RequestDocWithIdempotency = {
  idempotency?: Record<string, { key: string; at: string }>
}

/**
 * Read idempotency key from request header (trimmed, length-capped).
 * Returns null if missing or empty after trim.
 */
export function getIdempotencyKey(req: NextRequest): string | null {
  const raw = req.headers.get(HEADER)?.trim() ?? ""
  if (!raw) return null
  const key = raw.length > KEY_MAX_LENGTH ? raw.slice(0, KEY_MAX_LENGTH) : raw
  return key || null
}

export function isWithinWindow(atIso: string, now: Date, windowMs: number): boolean {
  const at = Date.parse(atIso)
  if (Number.isNaN(at)) return false
  return now.getTime() - at <= windowMs
}

export type AssertIdempotentOpts = {
  requestDoc: RequestDocWithIdempotency
  operation: string
  key: string
  now: Date
  windowMs?: number
}

/**
 * Check idempotency for a mutation on an existing request doc.
 * - No key → allow (no_key).
 * - Same key within window → replay (return same success without re-running).
 * - Different key within window → throw ConflictError (409).
 * - Otherwise record new key and return patch to persist.
 */
export function assertIdempotentOrRecord(opts: AssertIdempotentOpts): AssertResult {
  const { requestDoc, operation, key, now, windowMs = IDEMPOTENCY_WINDOW_MS } = opts
  if (!key) return { ok: true, mode: "no_key" }

  const existing = requestDoc.idempotency?.[operation]
  const base = requestDoc.idempotency ?? {}

  if (existing) {
    const inWindow = isWithinWindow(existing.at, now, windowMs)
    if (existing.key === key && inWindow) {
      return { ok: false, mode: "replay" }
    }
    if (existing.key !== key && inWindow) {
      throw new ConflictError(`Idempotency key mismatch for operation ${operation}`, operation)
    }
  }

  const patch: Record<string, { key: string; at: string }> = {
    ...base,
    [operation]: { key, at: now.toISOString() },
  }
  return { ok: true, mode: "recorded", patch: { idempotency: patch } }
}

// --- Create idempotency (in-memory; no request doc yet) ---

type CreateRecord = { requestId: string; at: string; requestDoc: Record<string, unknown> }
const createStore = new Map<string, CreateRecord>()

function pruneCreateStore(now: Date) {
  const cutoff = now.getTime() - IDEMPOTENCY_WINDOW_MS
  for (const [k, v] of createStore.entries()) {
    if (Date.parse(v.at) < cutoff) createStore.delete(k)
  }
}

export type CheckCreateResult =
  | { ok: true; mode: "no_key" }
  | { ok: false; mode: "replay"; requestDoc: Record<string, unknown> }
  | { ok: true; mode: "new" }

/**
 * Check create idempotency. If key was used recently, return replay with stored request doc.
 */
export function checkCreateIdempotency(key: string, now: Date): CheckCreateResult {
  if (!key) return { ok: true, mode: "no_key" }
  pruneCreateStore(now)
  const record = createStore.get(key)
  if (record && isWithinWindow(record.at, now, IDEMPOTENCY_WINDOW_MS)) {
    return { ok: false, mode: "replay", requestDoc: record.requestDoc }
  }
  return { ok: true, mode: "new" }
}

/**
 * Record a successful create for idempotency replay. Call after saveRequest.
 */
export function recordCreate(key: string, requestId: string, requestDoc: Record<string, unknown>, now: Date): void {
  if (!key) return
  createStore.set(key, { requestId, at: now.toISOString(), requestDoc })
  pruneCreateStore(now)
}
