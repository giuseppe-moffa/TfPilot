/**
 * Invariant tests: isLockActive (INV-LOCK-1).
 * Wired by test runner in Chunk 2. No runner deps here.
 */

import { isLockActive } from "@/lib/requests/lock"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const ACQUIRED_AT = "2026-02-01T10:00:00.000Z"

export const tests = [
  {
    name: "INV-LOCK-1: isLockActive FALSE when expiresAt < now",
    fn: () => {
      const now = new Date("2026-02-01T12:00:00.000Z")
      const lock = { holder: "sync", operation: "apply", acquiredAt: ACQUIRED_AT, expiresAt: "2026-02-01T11:00:00.000Z" }
      assert(isLockActive(lock, now) === false, "expected false when lock expired")
    },
  },
  {
    name: "INV-LOCK-1: isLockActive TRUE when expiresAt > now",
    fn: () => {
      const now = new Date("2026-02-01T10:30:00.000Z")
      const lock = { holder: "sync", operation: "apply", acquiredAt: ACQUIRED_AT, expiresAt: "2026-02-01T12:00:00.000Z" }
      assert(isLockActive(lock, now) === true, "expected true when lock not expired")
    },
  },
]
