/**
 * Invariant tests: buildAuditEvents determinism (INV-AUDIT).
 * Wired by test runner in Chunk 2. No runner deps here.
 */

import { buildAuditEvents } from "@/lib/requests/auditEvents"
import { makeRequest } from "../fixtures/requestFactory"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const NOW_ISO = "2026-02-28T12:00:00.000Z"

export const tests = [
  {
    name: "INV-AUDIT: buildAuditEvents deterministic — two calls with same request + same nowIso => deep equal arrays",
    fn: () => {
      const request = makeRequest({ receivedAt: "2026-02-01T09:00:00.000Z" })
      const a = buildAuditEvents(request as Parameters<typeof buildAuditEvents>[0], NOW_ISO)
      const b = buildAuditEvents(request as Parameters<typeof buildAuditEvents>[0], NOW_ISO)
      assert(a.length === b.length, `length mismatch: ${a.length} vs ${b.length}`)
      for (let i = 0; i < a.length; i++) {
        assert(
          JSON.stringify(a[i]) === JSON.stringify(b[i]),
          `event ${i} differs: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`
        )
      }
    },
  },
]
