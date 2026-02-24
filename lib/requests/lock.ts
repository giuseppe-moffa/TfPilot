/**
 * Request-level lock primitives. Used to prevent concurrent mutations on the same request.
 * Phase 1: infrastructure only; no route behavior change yet.
 */

/** Default TTL for an acquired lock: 2 minutes. */
export const LOCK_TTL_MS = 2 * 60 * 1000

export type RequestLock = {
  holder: string
  operation: string
  acquiredAt: string
  expiresAt: string
}

export type RequestDocWithLock = {
  lock?: RequestLock
}

export class LockConflictError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly holder: string
  ) {
    super(message)
    this.name = "LockConflictError"
  }
}

export type AcquireLockOpts = {
  requestDoc: RequestDocWithLock
  operation: string
  holder: string
  now: Date
  ttlMs?: number
}

export type AcquireLockResult =
  | { ok: true; patch: { lock: RequestLock } }
  | { ok: true; patch: null }

/**
 * Returns true if the lock's expiresAt is in the past (or invalid).
 */
export function isLockExpired(lock: RequestLock | undefined, now: Date): boolean {
  if (!lock?.expiresAt) return true
  const t = Date.parse(lock.expiresAt)
  return Number.isNaN(t) || now.getTime() >= t
}

/**
 * Attempt to acquire a lock on the request for the given operation and holder.
 * - No lock or expired lock → return { ok: true, patch } to set the new lock.
 * - Same holder already holds (non-expired) lock → return { ok: true, patch: null }.
 * - Different holder holds non-expired lock → throw LockConflictError.
 */
export function acquireLock(opts: AcquireLockOpts): AcquireLockResult {
  const { requestDoc, operation, holder, now, ttlMs = LOCK_TTL_MS } = opts
  const existing = requestDoc.lock

  if (!existing || isLockExpired(existing, now)) {
    const acquiredAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    return {
      ok: true,
      patch: {
        lock: {
          holder,
          operation,
          acquiredAt,
          expiresAt,
        },
      },
    }
  }

  if (existing.holder === holder) {
    return { ok: true, patch: null }
  }

  throw new LockConflictError(
    `Request locked by ${existing.holder} for operation ${existing.operation}`,
    existing.operation,
    existing.holder
  )
}

/**
 * Return a patch that clears the lock if the current holder matches.
 * Caller should apply the patch only when holder matches; if holder does not match, returns null.
 * Patch is { lock: undefined }; the store persists via JSON.stringify, which omits undefined keys, so the lock is removed from the stored document.
 */
export function releaseLock(
  requestDoc: RequestDocWithLock,
  holder: string
): { lock: undefined } | null {
  const existing = requestDoc.lock
  if (!existing) return { lock: undefined }
  if (existing.holder !== holder) return null
  return { lock: undefined }
}
