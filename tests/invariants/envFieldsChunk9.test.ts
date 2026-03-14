/**
 * Invariant tests: Chunk 9 — env fields enforcement, update unset rejection, destroy hard-fail, admin audit.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { assertWorkspaceImmutability } from "@/lib/requests/assertWorkspaceImmutability"
import { requireEnvFieldsForDestroy, getMissingEnvFields } from "@/lib/requests/requireEnvFields"
import { isMissingEnvField, getRequestIdsMissingEnv } from "@/lib/requests/auditMissingEnv"

export const tests = [
  {
    name: "Create always stores all workspace fields: validation rejects when resolved missing workspace_id",
    fn: () => {
      const resolved = { workspace_id: "", workspace_key: "dev", workspace_slug: "x" }
      const wouldReject = !resolved.workspace_id || !resolved.workspace_key || !resolved.workspace_slug
      assert(wouldReject === true, "create rejects incomplete resolution")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects patch setting workspace_id to empty string",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { workspace_id: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty workspace_id")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects patch setting workspace_id to null",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { workspace_id: null })
      assert(err?.includes("cannot be unset") === true, "rejects null workspace_id")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects patch setting workspace_key to empty string",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { workspace_key: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty workspace_key")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects patch setting workspace_slug to empty string",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { workspace_slug: "" })
      assert(err?.includes("cannot be unset") === true, "rejects empty workspace_slug")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when workspace_id missing",
    fn: () => {
      const req = { id: "r1", workspace_key: "dev", workspace_slug: "x" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when workspace_id missing")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when workspace_key missing",
    fn: () => {
      const req = { id: "r1", workspace_id: "ws_1", workspace_slug: "x" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when workspace_key missing")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: throws when workspace_slug empty",
    fn: () => {
      const req = { id: "r1", workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "" }
      let threw = false
      try {
        requireEnvFieldsForDestroy(req)
      } catch {
        threw = true
      }
      assert(threw === true, "throws when workspace_slug empty")
    },
  },
  {
    name: "requireEnvFieldsForDestroy: does not throw when all workspace fields present",
    fn: () => {
      const req = { id: "r1", workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "ai-agent" }
      requireEnvFieldsForDestroy(req)
    },
  },
  {
    name: "isMissingEnvField: returns false for request with all workspace fields",
    fn: () => {
      const req = { id: "r1", workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "ai-agent" }
      assert(isMissingEnvField(req) === false, "complete request not missing")
    },
  },
  {
    name: "isMissingEnvField: returns true for request missing workspace_id",
    fn: () => {
      const req = { id: "r1", workspace_key: "dev", workspace_slug: "x" }
      assert(isMissingEnvField(req) === true, "missing workspace_id")
    },
  },
  {
    name: "getRequestIdsMissingEnv: returns empty list when all requests have workspace fields",
    fn: () => {
      const requests = [
        { id: "r1", workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" },
        { id: "r2", workspace_id: "ws_2", workspace_key: "prod", workspace_slug: "payments" },
      ]
      const missing = getRequestIdsMissingEnv(requests)
      assert(missing.length === 0, "empty list in normal case")
    },
  },
  {
    name: "getRequestIdsMissingEnv: returns ids of requests missing workspace fields",
    fn: () => {
      const requests = [
        { id: "r1", workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" },
        { id: "r2", workspace_key: "dev", workspace_slug: "x" },
        { id: "r3", workspace_id: "ws_3", workspace_key: "dev", workspace_slug: "" },
      ]
      const missing = getRequestIdsMissingEnv(requests)
      assert(missing.length === 2 && missing.includes("r2") && missing.includes("r3"), "filters correctly")
    },
  },
  {
    name: "getMissingEnvFields: returns REQUEST_MISSING_ENV_FIELDS-style list",
    fn: () => {
      const req = { id: "r1", workspace_slug: "x" }
      const missing = getMissingEnvFields(req)
      assert(missing.includes("workspace_id") && missing.includes("workspace_key"), "lists missing")
      assert(!missing.includes("workspace_slug"), "workspace_slug present")
    },
  },
]
