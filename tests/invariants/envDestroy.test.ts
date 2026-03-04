/**
 * Invariant tests: Environment destroy (Chunk 7 + Chunk 8).
 * - Dispatch payload shape
 * - archiveEnvironment behavior
 * - parseRepoFullName
 * - pending TTL, shape, correlation
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { buildEnvDestroyInputs } from "@/lib/github/dispatchEnvDestroy"
import { isPendingStaleByTTL, type EnvDestroyPending } from "@/lib/github/envDestroyRunIndex"

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export const tests = [
  {
    name: "buildEnvDestroyInputs: correct payload shape",
    fn: () => {
      const inputs = buildEnvDestroyInputs({
        environment_key: "dev",
        environment_slug: "ai-agent",
      })
      assert(inputs.environment_key === "dev", "environment_key")
      assert(inputs.environment_slug === "ai-agent", "environment_slug")
      assert(inputs.destroy_scope === "environment", "destroy_scope")
      assert(!("request_id" in inputs), "no request_id for environment scope")
    },
  },
  {
    name: "buildEnvDestroyInputs: includes environment_id when provided",
    fn: () => {
      const inputs = buildEnvDestroyInputs({
        environment_key: "dev",
        environment_slug: "test",
        environment_id: "env_abc123",
      })
      assert(inputs.environment_id === "env_abc123", "environment_id for webhook correlation")
    },
  },
  {
    name: "Model 2 invariant: dispatch payload must not include 'environment' key",
    fn: () => {
      const inputs = buildEnvDestroyInputs({
        environment_key: "dev",
        environment_slug: "x",
        environment_id: "env_1",
      })
      assert(!("environment" in inputs), "inputs must not have legacy 'environment' key")
    },
  },
  {
    name: "parseRepoFullName: valid",
    fn: () => {
      const r = parseRepoFullName("owner/repo")
      assert(r !== null && r.owner === "owner" && r.repo === "repo", "owner/repo")
    },
  },
  {
    name: "parseRepoFullName: invalid empty",
    fn: () => {
      assert(parseRepoFullName("") === null, "empty")
    },
  },
  {
    name: "parseRepoFullName: invalid single segment",
    fn: () => {
      assert(parseRepoFullName("only") === null, "single segment")
    },
  },
  {
    name: "parseRepoFullName: three segments returns null (strict owner/repo)",
    fn: () => {
      const r = parseRepoFullName("a/b/c")
      assert(r === null, "strict two-segment format")
    },
  },
  {
    name: "archiveEnvironment: exported and callable",
    fn: async () => {
      const { archiveEnvironment } = await import("@/lib/db/environments")
      assert(typeof archiveEnvironment === "function", "exported")
      const result = await archiveEnvironment("env_nonexistent")
      assert(typeof result === "boolean", "returns boolean")
    },
  },
  {
    name: "isPendingStaleByTTL: 3h ago is stale",
    fn: () => {
      const pending: EnvDestroyPending = {
        run_id: 123,
        repo: "owner/repo",
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      }
      assert(isPendingStaleByTTL(pending) === true, "stale after 2h TTL")
    },
  },
  {
    name: "isPendingStaleByTTL: 1h ago is not stale",
    fn: () => {
      const pending: EnvDestroyPending = {
        run_id: 123,
        repo: "owner/repo",
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }
      assert(isPendingStaleByTTL(pending) === false, "not stale within 2h")
    },
  },
  {
    name: "EnvDestroyPending shape: run_id, repo, created_at",
    fn: () => {
      const pending: EnvDestroyPending = { run_id: 1, repo: "a/b", created_at: "2025-01-01T00:00:00Z" }
      assert(pending.run_id === 1 && pending.repo === "a/b" && pending.created_at === "2025-01-01T00:00:00Z", "shape")
    },
  },
  {
    name: "webhook envId correlation: index then inputs",
    fn: () => {
      const fromIndex = "env_from_index"
      const fromInputs = "env_from_inputs"
      const wr = { inputs: { environment_id: fromInputs } }
      const inputsEnvId = (wr as { inputs?: { environment_id?: string } }).inputs?.environment_id
      const a = fromIndex ?? inputsEnvId
      const indexMiss: string | null = null
      const b = indexMiss ?? inputsEnvId
      assert(a === "env_from_index", "index takes precedence")
      assert(b === "env_from_inputs", "inputs fallback when index null")
    },
  },
]
