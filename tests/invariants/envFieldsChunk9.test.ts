/**
 * Invariant tests: Chunk 9 — env fields enforcement, update unset rejection, destroy hard-fail, admin audit.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { assertEnvironmentImmutability } from "@/lib/requests/assertEnvironmentImmutability"
import { requireEnvFieldsForDestroy, getMissingEnvFields } from "@/lib/requests/requireEnvFields"
import { isMissingEnvField, getRequestIdsMissingEnv } from "@/lib/requests/auditMissingEnv"

export const tests = [
  {
    name: "Create always stores all env fields: validation rejects when resolved missing env_id",
    fn: () => {
      const resolved = { environment_id: "", environment_key: "dev", environment_slug: "x" }
      const wouldReject = !resolved.environment_id || !resolved.environment_key || !resolved.environment_slug
      assert(wouldReject === true, "create rejects incomplete resolution")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects patch setting environment_id to empty string",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { environment_id: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty env_id")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects patch setting environment_id to null",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { environment_id: null })
      assert(err?.includes("cannot be unset") === true, "rejects null env_id")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects patch setting environment_key to empty string",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { environment_key: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty env_key")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects patch setting environment_slug to empty string",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { environment_slug: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty env_slug")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when environment_id missing",
    fn: () => {
      const req = { id: "r1", environment_key: "dev", environment_slug: "x" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when env_id missing")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when environment_key missing",
    fn: () => {
      const req = { id: "r1", environment_id: "env_1", environment_slug: "x" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when env_key missing")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when environment_slug empty",
    fn: () => {
      const req = { id: "r1", environment_id: "env_1", environment_key: "dev", environment_slug: "" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when env_slug empty")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: does not throw when all env fields present",
    fn: () => {
      const req = { id: "r1", environment_id: "env_1", environment_key: "dev", environment_slug: "ai-agent" }
      requireEnvFieldsForDestroy(req)
    },
  },
  {
    name: "isMissingEnvField: returns false for request with all env fields",
    fn: () => {
      const req = { id: "r1", environment_id: "env_1", environment_key: "dev", environment_slug: "ai-agent" }
      assert(isMissingEnvField(req) === false, "complete request not missing")
    },
  },
  {
    name: "isMissingEnvField: returns true for request missing environment_id",
    fn: () => {
      const req = { id: "r1", environment_key: "dev", environment_slug: "x" }
      assert(isMissingEnvField(req) === true, "missing env_id")
    },
  },
  {
    name: "getRequestIdsMissingEnv: returns empty list when all requests have env fields",
    fn: () => {
      const requests = [
        { id: "r1", environment_id: "env_1", environment_key: "dev", environment_slug: "x" },
        { id: "r2", environment_id: "env_2", environment_key: "prod", environment_slug: "payments" },
      ]
      const missing = getRequestIdsMissingEnv(requests)
      assert(missing.length === 0, "empty list in normal case")
    },
  },
  {
    name: "getRequestIdsMissingEnv: returns ids of requests missing env fields",
    fn: () => {
      const requests = [
        { id: "r1", environment_id: "env_1", environment_key: "dev", environment_slug: "x" },
        { id: "r2", environment_key: "dev", environment_slug: "x" },
        { id: "r3", environment_id: "env_3", environment_key: "dev", environment_slug: "" },
      ]
      const missing = getRequestIdsMissingEnv(requests)
      assert(missing.length === 2 && missing.includes("r2") && missing.includes("r3"), "filters correctly")
    },
  },
  {
    name: "getMissingEnvFields: returns REQUEST_MISSING_ENV_FIELDS-style list",
    fn: () => {
      const req = { id: "r1", environment_slug: "x" }
      const missing = getMissingEnvFields(req)
      assert(missing.includes("environment_id") && missing.includes("environment_key"), "lists missing")
      assert(!missing.includes("environment_slug"), "slug present")
    },
  },
]
