/**
 * Validation: expired locks are treated as inactive (do not block actions).
 * - isLockExpired(expiredLock, now) === true
 * - isLockActive(expiredLock, now) === false
 * - acquireLock with expired lock does not throw (returns patch to set new lock)
 * Run: npx tsx scripts/validate-lock-expired.ts
 */

import {
  acquireLock,
  isLockActive,
  isLockExpired,
  type RequestLock,
} from "../lib/requests/lock"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const now = new Date()
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

const expiredLock: RequestLock = {
  holder: "other",
  operation: "apply",
  acquiredAt: oneHourAgo.toISOString(),
  expiresAt: oneHourAgo.toISOString(),
}

const activeLock: RequestLock = {
  holder: "other",
  operation: "apply",
  acquiredAt: now.toISOString(),
  expiresAt: inOneHour.toISOString(),
}

// 1. Expired lock: isLockExpired true, isLockActive false
assert(isLockExpired(expiredLock, now), "expired lock → isLockExpired true")
assert(!isLockActive(expiredLock, now), "expired lock → isLockActive false (does not disable actions)")

// 2. Active lock: isLockExpired false, isLockActive true
assert(!isLockExpired(activeLock, now), "active lock → isLockExpired false")
assert(isLockActive(activeLock, now), "active lock → isLockActive true")

// 3. No lock / invalid: isLockActive false
assert(!isLockActive(undefined, now), "no lock → isLockActive false")
assert(!isLockActive({} as RequestLock, now), "lock without expiresAt → isLockActive false")
assert(
  !isLockActive({ ...expiredLock, expiresAt: "not-a-date" }, now),
  "invalid expiresAt → isLockActive false"
)

// 4. acquireLock with expired lock does not throw (treat as no lock)
const result = acquireLock({
  requestDoc: { lock: expiredLock },
  operation: "apply",
  holder: "new-holder",
  now,
})
assert(result.ok === true && result.patch != null, "expired lock → acquireLock returns patch (no LockConflictError)")

// 5. acquireLock with active lock from different holder throws
let threw = false
try {
  acquireLock({
    requestDoc: { lock: activeLock },
    operation: "apply",
    holder: "different-holder",
    now,
  })
} catch {
  threw = true
}
assert(threw, "active lock from different holder → acquireLock throws LockConflictError")

console.log("validate-lock-expired: all assertions passed")

/*
 * Manual verification (sync clears expired locks):
 * 1. Create or pick a request and set request.lock in S3 with expiresAt in the past (e.g. one hour ago).
 * 2. Call GET /api/requests/[requestId]/sync (with session). With DEBUG_WEBHOOKS=1 you should see event=sync.lock_cleared_expired in server logs.
 * 3. Re-fetch the request (or reload the request page); request.lock should be absent.
 * 4. UI: With an expired lock present, action buttons (Apply/Destroy etc.) should be enabled; after sync they stay enabled and lock is cleared.
 */