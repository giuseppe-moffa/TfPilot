/**
 * Unit tests: idempotency logic (assertIdempotentOrRecord, checkCreateIdempotency, etc.).
 * No external deps; pure logic tests.
 */

import { NextRequest } from "next/server"
import {
  getIdempotencyKey,
  isWithinWindow,
  assertIdempotentOrRecord,
  checkCreateIdempotency,
  recordCreate,
  ConflictError,
  IDEMPOTENCY_WINDOW_MS,
} from "@/lib/requests/idempotency"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function reqWithKey(key: string | null): NextRequest {
  const headers: Record<string, string> = {}
  if (key != null && key !== "") headers["x-idempotency-key"] = key
  return new NextRequest("http://localhost/api/requests", {
    method: "POST",
    headers,
  })
}

export const tests = [
  // --- getIdempotencyKey ---
  {
    name: "getIdempotencyKey: missing header returns null",
    fn: () => {
      const req = new NextRequest("http://localhost/api/requests", { method: "POST" })
      const key = getIdempotencyKey(req)
      assert(key === null, `expected null, got ${key}`)
    },
  },
  {
    name: "getIdempotencyKey: empty string returns null",
    fn: () => {
      const req = reqWithKey("")
      const key = getIdempotencyKey(req)
      assert(key === null, `expected null, got ${key}`)
    },
  },
  {
    name: "getIdempotencyKey: whitespace-only returns null",
    fn: () => {
      const req = reqWithKey("   ")
      const key = getIdempotencyKey(req)
      assert(key === null, `expected null, got ${key}`)
    },
  },
  {
    name: "getIdempotencyKey: present key returns trimmed value",
    fn: () => {
      const req = reqWithKey("  my-key-123  ")
      const key = getIdempotencyKey(req)
      assert(key === "my-key-123", `expected "my-key-123", got ${JSON.stringify(key)}`)
    },
  },
  {
    name: "getIdempotencyKey: key longer than 512 chars is capped",
    fn: () => {
      const long = "a".repeat(600)
      const req = reqWithKey(long)
      const key = getIdempotencyKey(req)
      assert(key !== null, "expected non-null")
      assert(key!.length === 512, `expected length 512, got ${key!.length}`)
      assert(key!.startsWith("a"), "expected prefix preserved")
    },
  },

  // --- isWithinWindow ---
  {
    name: "isWithinWindow: inside valid window returns true",
    fn: () => {
      const at = "2026-01-01T12:00:00.000Z"
      const now = new Date("2026-01-01T12:05:00.000Z")
      const ok = isWithinWindow(at, now, 10 * 60 * 1000)
      assert(ok === true, `expected true, got ${ok}`)
    },
  },
  {
    name: "isWithinWindow: outside valid window returns false",
    fn: () => {
      const at = "2026-01-01T12:00:00.000Z"
      const now = new Date("2026-01-01T12:11:00.000Z")
      const ok = isWithinWindow(at, now, 10 * 60 * 1000)
      assert(ok === false, `expected false, got ${ok}`)
    },
  },
  {
    name: "isWithinWindow: exactly at boundary returns true",
    fn: () => {
      const at = "2026-01-01T12:00:00.000Z"
      const now = new Date("2026-01-01T12:10:00.000Z")
      const ok = isWithinWindow(at, now, 10 * 60 * 1000)
      assert(ok === true, `expected true at boundary, got ${ok}`)
    },
  },
  {
    name: "isWithinWindow: invalid date returns false",
    fn: () => {
      const ok = isWithinWindow("not-a-date", new Date(), 60000)
      assert(ok === false, `expected false for invalid date, got ${ok}`)
    },
  },

  // --- assertIdempotentOrRecord ---
  {
    name: "assertIdempotentOrRecord: missing key returns no_key",
    fn: () => {
      const res = assertIdempotentOrRecord({
        requestDoc: {},
        operation: "apply",
        key: "",
        now: new Date(),
      })
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "no_key", `expected mode no_key, got ${res.mode}`)
    },
  },
  {
    name: "assertIdempotentOrRecord: first-time request returns recorded with patch",
    fn: () => {
      const now = new Date()
      const res = assertIdempotentOrRecord({
        requestDoc: {},
        operation: "apply",
        key: "first-key",
        now,
      })
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "recorded", `expected mode recorded, got ${res.mode}`)
      if (res.mode === "recorded") {
        assert(res.patch.idempotency.apply.key === "first-key", "expected correct key in patch")
        assert(res.patch.idempotency.apply.at === now.toISOString(), "expected correct at in patch")
      }
    },
  },
  {
    name: "assertIdempotentOrRecord: replay same key within window returns replay",
    fn: () => {
      const now = new Date()
      const requestDoc = {
        idempotency: {
          apply: { key: "replay-key", at: now.toISOString() },
        },
      }
      const res = assertIdempotentOrRecord({
        requestDoc,
        operation: "apply",
        key: "replay-key",
        now,
      })
      assert(res.ok === false, "expected ok false for replay")
      assert(res.mode === "replay", `expected mode replay, got ${res.mode}`)
    },
  },
  {
    name: "assertIdempotentOrRecord: same key different operation records separately",
    fn: () => {
      const now = new Date()
      const requestDoc = {
        idempotency: {
          apply: { key: "key-a", at: now.toISOString() },
        },
      }
      const res = assertIdempotentOrRecord({
        requestDoc,
        operation: "approve",
        key: "key-b",
        now,
      })
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "recorded", `expected mode recorded, got ${res.mode}`)
      if (res.mode === "recorded") {
        assert(res.patch.idempotency.apply.key === "key-a", "existing operation preserved")
        assert(res.patch.idempotency.approve.key === "key-b", "new operation recorded")
      }
    },
  },
  {
    name: "assertIdempotentOrRecord: different key within window throws ConflictError",
    fn: () => {
      const now = new Date()
      const requestDoc = {
        idempotency: {
          apply: { key: "original-key", at: now.toISOString() },
        },
      }
      let threw = false
      try {
        assertIdempotentOrRecord({
          requestDoc,
          operation: "apply",
          key: "different-key",
          now,
        })
      } catch (err) {
        threw = true
        assert(err instanceof ConflictError, `expected ConflictError, got ${err}`)
        assert((err as ConflictError).operation === "apply", "expected operation apply")
        assert(
          (err as Error).message.includes("Idempotency key mismatch"),
          "expected mismatch message"
        )
      }
      assert(threw, "expected ConflictError to be thrown")
    },
  },
  {
    name: "assertIdempotentOrRecord: same key outside window returns recorded (not replay)",
    fn: () => {
      const oldAt = "2026-01-01T12:00:00.000Z"
      const now = new Date("2026-01-01T12:15:00.000Z")
      const requestDoc = {
        idempotency: {
          apply: { key: "old-key", at: oldAt },
        },
      }
      const res = assertIdempotentOrRecord({
        requestDoc,
        operation: "apply",
        key: "old-key",
        now,
        windowMs: 10 * 60 * 1000,
      })
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "recorded", `expected mode recorded (outside window), got ${res.mode}`)
      if (res.mode === "recorded") {
        assert(res.patch.idempotency.apply.key === "old-key", "expected key in patch")
      }
    },
  },

  // --- checkCreateIdempotency ---
  {
    name: "checkCreateIdempotency: missing key returns no_key",
    fn: () => {
      const res = checkCreateIdempotency("", new Date())
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "no_key", `expected mode no_key, got ${res.mode}`)
    },
  },
  {
    name: "checkCreateIdempotency: first-time key returns new",
    fn: () => {
      const key = `idem-create-new-${Date.now()}`
      const res = checkCreateIdempotency(key, new Date())
      assert(res.ok === true, "expected ok true")
      assert(res.mode === "new", `expected mode new, got ${res.mode}`)
    },
  },
  {
    name: "checkCreateIdempotency: replay after recordCreate returns replay with requestDoc",
    fn: () => {
      const key = `idem-create-replay-${Date.now()}`
      const now = new Date()
      const requestDoc = { id: "req_test", project_key: "core" }
      recordCreate(key, "req_test", requestDoc, now)
      const res = checkCreateIdempotency(key, now)
      assert(res.ok === false, "expected ok false for replay")
      assert(res.mode === "replay", `expected mode replay, got ${res.mode}`)
      assert("requestDoc" in res, "expected requestDoc in replay result")
      assert((res as { requestDoc: Record<string, unknown> }).requestDoc.id === "req_test", "expected stored requestDoc")
    },
  },

  // --- recordCreate ---
  {
    name: "recordCreate: empty key is no-op (does not throw)",
    fn: () => {
      recordCreate("", "req_1", { id: "req_1" }, new Date())
      const res = checkCreateIdempotency("", new Date())
      assert(res.mode === "no_key", "empty key should not be stored; checkCreate returns no_key")
    },
  },

  // --- IDEMPOTENCY_WINDOW_MS ---
  {
    name: "IDEMPOTENCY_WINDOW_MS: is 10 minutes",
    fn: () => {
      assert(IDEMPOTENCY_WINDOW_MS === 10 * 60 * 1000, `expected 600000, got ${IDEMPOTENCY_WINDOW_MS}`)
    },
  },

  // --- Determinism ---
  {
    name: "determinism: same inputs to assertIdempotentOrRecord produce same outcome",
    fn: () => {
      const requestDoc = {}
      const opts = {
        requestDoc,
        operation: "apply",
        key: "det-key",
        now: new Date("2026-01-01T12:00:00.000Z"),
      }
      const r1 = assertIdempotentOrRecord(opts)
      const r2 = assertIdempotentOrRecord({ ...opts, requestDoc: { ...requestDoc } })
      assert(r1.mode === r2.mode, `expected same mode, got ${r1.mode} vs ${r2.mode}`)
      assert(r1.ok === r2.ok, `expected same ok, got ${r1.ok} vs ${r2.ok}`)
    },
  },
]
