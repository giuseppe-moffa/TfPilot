/**
 * Unit tests: request index projection (computeDocHash, projectRequestToIndexValues).
 * No DB/S3; pure logic tests. Locks in deterministic hashing and projection behavior.
 */

import type { RequestDocForIndex } from "@/lib/db/indexer"
import {
  computeDocHash,
  projectRequestToIndexValues,
} from "@/lib/db/indexer"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function minimalRequest(overrides: Partial<RequestDocForIndex> = {}): RequestDocForIndex {
  return {
    id: "req_abc123",
    org_id: "org_default",
    receivedAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T11:00:00.000Z",
    ...overrides,
  }
}

export const tests = [
  // --- stableStringify determinism (via computeDocHash) ---
  {
    name: "stableStringify determinism: same object different key order produces same hash",
    fn: () => {
      const a = { id: "x", org_id: "o", z: 1, a: 2 }
      const b = { a: 2, z: 1, org_id: "o", id: "x" }
      const hashA = computeDocHash(a as RequestDocForIndex)
      const hashB = computeDocHash(b as RequestDocForIndex)
      assert(hashA === hashB, `expected same hash, got ${hashA} vs ${hashB}`)
    },
  },
  {
    name: "stableStringify determinism: nested objects remain deterministic",
    fn: () => {
      const a = { id: "x", org_id: "o", config: { tags: { b: 2, a: 1 } } }
      const b = { org_id: "o", id: "x", config: { tags: { a: 1, b: 2 } } }
      const hashA = computeDocHash(a as RequestDocForIndex)
      const hashB = computeDocHash(b as RequestDocForIndex)
      assert(hashA === hashB, `expected same hash for nested, got ${hashA} vs ${hashB}`)
    },
  },
  {
    name: "stableStringify determinism: semantically identical arrays remain order-sensitive",
    fn: () => {
      const a = { id: "x", org_id: "o", arr: [1, 2] }
      const b = { id: "x", org_id: "o", arr: [2, 1] }
      const hashA = computeDocHash(a as RequestDocForIndex)
      const hashB = computeDocHash(b as RequestDocForIndex)
      assert(hashA !== hashB, `expected different hashes for different array order, got same ${hashA}`)
    },
  },

  // --- computeDocHash ---
  {
    name: "computeDocHash: same semantic doc produces same hash",
    fn: () => {
      const doc = minimalRequest()
      const h1 = computeDocHash(doc)
      const h2 = computeDocHash(doc)
      assert(h1 === h2, `expected identical hashes, got ${h1} vs ${h2}`)
    },
  },
  {
    name: "computeDocHash: different doc produces different hash",
    fn: () => {
      const d1 = minimalRequest({ id: "req_1" })
      const d2 = minimalRequest({ id: "req_2" })
      const h1 = computeDocHash(d1)
      const h2 = computeDocHash(d2)
      assert(h1 !== h2, `expected different hashes for different docs`)
    },
  },
  {
    name: "computeDocHash: hash is 64-char hex (SHA-256)",
    fn: () => {
      const doc = minimalRequest()
      const h = computeDocHash(doc)
      assert(/^[a-f0-9]{64}$/.test(h), `expected 64-char hex, got ${h}`)
    },
  },

  // --- projectRequestToIndexValues happy path ---
  {
    name: "projectRequestToIndexValues: valid request projects expected indexed fields",
    fn: () => {
      const req = minimalRequest({
        targetOwner: "owner",
        targetRepo: "repo",
        workspace_key: "dev",
        workspace_slug: "ai-agent",
        module: "ec2-instance",
        actor: "alice",
        pr: { number: 42 },
        mergedSha: "abc123",
        lastActionAt: "2026-01-15T12:00:00.000Z",
      })
      const values = projectRequestToIndexValues(req)
      assert(values.length === 13, `expected 13 values, got ${values.length}`)
      assert(values[0] === "req_abc123", "request_id")
      assert(values[1] === "org_default", "org_id")
      assert(values[2] === "2026-01-15T10:00:00.000Z", "created_at from receivedAt")
      assert(values[3] === "2026-01-15T11:00:00.000Z", "updated_at")
      assert(values[4] === "owner/repo", "repo_full_name")
      assert(values[5] === "dev", "workspace_key")
      assert(values[6] === "ai-agent", "workspace_slug")
      assert(values[7] === "ec2-instance", "module_key")
      assert(values[8] === "alice", "actor")
      assert(values[9] === 42, "pr_number")
      assert(values[10] === "abc123", "merged_sha")
      assert(values[11] === "2026-01-15T12:00:00.000Z", "last_activity_at")
      assert(typeof values[12] === "string" && (values[12] as string).length === 64, "doc_hash")
    },
  },

  // --- Missing required org_id ---
  {
    name: "projectRequestToIndexValues: missing org_id throws",
    fn: () => {
      const req = minimalRequest({ org_id: undefined })
      let threw = false
      try {
        projectRequestToIndexValues(req)
      } catch (e) {
        threw = true
        const msg = e instanceof Error ? e.message : String(e)
        assert(
          msg.includes("missing org_id") && msg.includes("req_abc123"),
          `expected specific error, got ${msg}`
        )
      }
      assert(threw, "expected throw when org_id missing")
    },
  },
  {
    name: "projectRequestToIndexValues: empty org_id throws",
    fn: () => {
      const req = minimalRequest({ org_id: "" })
      let threw = false
      try {
        projectRequestToIndexValues(req)
      } catch (e) {
        threw = true
      }
      assert(threw, "expected throw when org_id empty")
    },
  },
  {
    name: "projectRequestToIndexValues: whitespace-only org_id throws",
    fn: () => {
      const req = minimalRequest({ org_id: "   " })
      let threw = false
      try {
        projectRequestToIndexValues(req)
      } catch (e) {
        threw = true
      }
      assert(threw, "expected throw when org_id whitespace-only")
    },
  },
  {
    name: "projectRequestToIndexValues: org_id trimmed",
    fn: () => {
      const req = minimalRequest({ org_id: "  org_trim  " })
      const values = projectRequestToIndexValues(req)
      assert(values[1] === "org_trim", `expected trimmed org_id, got ${JSON.stringify(values[1])}`)
    },
  },

  // --- Optional/missing fields ---
  {
    name: "projectRequestToIndexValues: createdAt fallback receivedAt then createdAt then updatedAt",
    fn: () => {
      const req = minimalRequest({
        receivedAt: "2026-01-10T00:00:00.000Z",
        createdAt: undefined,
        updatedAt: "2026-01-15T11:00:00.000Z",
      })
      const values = projectRequestToIndexValues(req)
      assert(values[2] === "2026-01-10T00:00:00.000Z", "created_at uses receivedAt first")
    },
  },
  {
    name: "projectRequestToIndexValues: updatedAt fallback updatedAt then receivedAt",
    fn: () => {
      const req = minimalRequest({
        receivedAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-01-12T00:00:00.000Z",
      })
      const values = projectRequestToIndexValues(req)
      assert(values[3] === "2026-01-12T00:00:00.000Z", "updated_at uses updatedAt")
    },
  },
  {
    name: "projectRequestToIndexValues: repo_full_name from targetOwner+targetRepo",
    fn: () => {
      const req = minimalRequest({ targetOwner: "acme", targetRepo: "infra" })
      const values = projectRequestToIndexValues(req)
      assert(values[4] === "acme/infra", `expected acme/infra, got ${values[4]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: repo_full_name from targetRepo only when no owner",
    fn: () => {
      const req = minimalRequest({ targetOwner: undefined, targetRepo: "solo-repo" })
      const values = projectRequestToIndexValues(req)
      assert(values[4] === "solo-repo", `expected solo-repo, got ${values[4]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: repo_full_name null when both missing",
    fn: () => {
      const req = minimalRequest({ targetOwner: undefined, targetRepo: undefined })
      const values = projectRequestToIndexValues(req)
      assert(values[4] === null, `expected null repo, got ${values[4]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: actor from config.tags tfpilot:created_by when actor missing",
    fn: () => {
      const req = minimalRequest({
        actor: undefined,
        config: { tags: { "tfpilot:created_by": "bot-user" } },
      })
      const values = projectRequestToIndexValues(req)
      assert(values[8] === "bot-user", `expected actor from tag, got ${values[8]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: actor prefers request.actor over config tag",
    fn: () => {
      const req = minimalRequest({
        actor: "explicit-actor",
        config: { tags: { "tfpilot:created_by": "tag-actor" } },
      })
      const values = projectRequestToIndexValues(req)
      assert(values[8] === "explicit-actor", `expected request.actor, got ${values[8]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: optional fields null when missing",
    fn: () => {
      const req = minimalRequest({
        environment_key: undefined,
        environment_slug: undefined,
        module: undefined,
        pr: undefined,
        mergedSha: undefined,
        lastActionAt: undefined,
        actor: undefined,
        config: undefined,
      })
      const values = projectRequestToIndexValues(req)
      assert(values[5] === null, "environment_key null")
      assert(values[6] === null, "environment_slug null")
      assert(values[7] === null, "module_key null")
      assert(values[8] === null, "actor null")
      assert(values[9] === null, "pr_number null")
      assert(values[10] === null, "merged_sha null")
      assert(values[11] === null, "last_activity_at null")
    },
  },

  // --- Projection determinism ---
  {
    name: "projectRequestToIndexValues: same input yields same projected values",
    fn: () => {
      const req = minimalRequest({
        targetOwner: "o",
        targetRepo: "r",
        environment_key: "dev",
        module: "m",
      })
      const v1 = projectRequestToIndexValues(req)
      const v2 = projectRequestToIndexValues(req)
      assert(v1.length === v2.length, "same length")
      for (let i = 0; i < v1.length; i++) {
        assert(
          JSON.stringify(v1[i]) === JSON.stringify(v2[i]),
          `index ${i} differs: ${JSON.stringify(v1[i])} vs ${JSON.stringify(v2[i])}`
        )
      }
    },
  },

  // --- Normalization ---
  {
    name: "projectRequestToIndexValues: timestamps present use them (deterministic)",
    fn: () => {
      const req = minimalRequest({
        receivedAt: "2026-02-01T08:00:00.000Z",
        createdAt: "2026-02-01T09:00:00.000Z",
        updatedAt: "2026-02-01T10:00:00.000Z",
      })
      const values = projectRequestToIndexValues(req)
      assert(values[2] === "2026-02-01T08:00:00.000Z", "created_at from receivedAt")
      assert(values[3] === "2026-02-01T10:00:00.000Z", "updated_at from updatedAt")
    },
  },
  {
    name: "projectRequestToIndexValues: pr.number extracted correctly",
    fn: () => {
      const req = minimalRequest({ pr: { number: 99 } })
      const values = projectRequestToIndexValues(req)
      assert(values[9] === 99, `expected pr_number 99, got ${values[9]}`)
    },
  },
  {
    name: "projectRequestToIndexValues: config.tags non-string created_by yields null actor",
    fn: () => {
      const req = minimalRequest({
        actor: undefined,
        config: { tags: { "tfpilot:created_by": 123 } },
      })
      const values = projectRequestToIndexValues(req)
      assert(values[8] === null, "actor must be string from tag, number yields null")
    },
  },
  {
    name: "projectRequestToIndexValues: doc_hash matches computeDocHash output",
    fn: () => {
      const req = minimalRequest()
      const values = projectRequestToIndexValues(req)
      const expectedHash = computeDocHash(req)
      assert(values[12] === expectedHash, `hash in projection must match computeDocHash`)
    },
  },
]
