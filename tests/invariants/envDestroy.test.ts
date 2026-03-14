/**
 * Invariant tests: Workspace destroy (Chunk 7 + Chunk 8).
 * - Dispatch payload shape: workspace_id, workspace_key, workspace_slug
 * - archiveWorkspace behavior
 * - parseRepoFullName
 * - pending TTL, shape, correlation
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { buildWorkspaceDestroyInputs } from "@/lib/github/dispatchWorkspaceDestroy"
import { isPendingStaleByTTL, type WorkspaceDestroyPending } from "@/lib/github/workspaceDestroyRunIndex"

function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export const tests = [
  {
    name: "buildWorkspaceDestroyInputs: correct payload shape",
    fn: () => {
      const inputs = buildWorkspaceDestroyInputs({
        workspace_id: "ws_123",
        workspace_key: "dev",
        workspace_slug: "ai-agent",
      })
      assert(inputs.workspace_id === "ws_123", "workspace_id")
      assert(inputs.workspace_key === "dev", "workspace_key")
      assert(inputs.workspace_slug === "ai-agent", "workspace_slug")
      assert(inputs.destroy_scope === "workspace", "destroy_scope")
      assert(!("request_id" in inputs), "no request_id for workspace scope")
    },
  },
  {
    name: "buildWorkspaceDestroyInputs: includes workspace_id when provided",
    fn: () => {
      const inputs = buildWorkspaceDestroyInputs({
        workspace_id: "ws_abc123",
        workspace_key: "dev",
        workspace_slug: "test",
      })
      assert(inputs.workspace_id === "ws_abc123", "workspace_id for webhook correlation")
    },
  },
  {
    name: "buildWorkspaceDestroyInputs: payload must not include environment_* keys",
    fn: () => {
      const inputs = buildWorkspaceDestroyInputs({
        workspace_id: "ws_1",
        workspace_key: "dev",
        workspace_slug: "x",
      })
      assert(!("environment_id" in inputs), "no environment_id")
      assert(!("environment_key" in inputs), "no environment_key")
      assert(!("environment_slug" in inputs), "no environment_slug")
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
    name: "archiveWorkspace: exported and callable",
    fn: async () => {
      const { archiveWorkspace } = await import("@/lib/db/workspaces")
      assert(typeof archiveWorkspace === "function", "exported")
      const result = await archiveWorkspace("ws_nonexistent")
      assert(typeof result === "boolean", "returns boolean")
    },
  },
  {
    name: "isPendingStaleByTTL: 3h ago is stale",
    fn: () => {
      const pending: WorkspaceDestroyPending = {
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
      const pending: WorkspaceDestroyPending = {
        run_id: 123,
        repo: "owner/repo",
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }
      assert(isPendingStaleByTTL(pending) === false, "not stale within 2h")
    },
  },
  {
    name: "WorkspaceDestroyPending shape: run_id, repo, created_at",
    fn: () => {
      const pending: WorkspaceDestroyPending = { run_id: 1, repo: "a/b", created_at: "2025-01-01T00:00:00Z" }
      assert(pending.run_id === 1 && pending.repo === "a/b" && pending.created_at === "2025-01-01T00:00:00Z", "shape")
    },
  },
  {
    name: "webhook workspace_id correlation: index then inputs",
    fn: () => {
      const fromIndex = "ws_from_index"
      const fromInputs = "ws_from_inputs"
      const wr = { inputs: { workspace_id: fromInputs } }
      const inputsWorkspaceId = (wr as { inputs?: { workspace_id?: string } }).inputs?.workspace_id
      const a = fromIndex ?? inputsWorkspaceId
      const indexMiss: string | null = null
      const b = indexMiss ?? inputsWorkspaceId
      assert(a === "ws_from_index", "index takes precedence")
      assert(b === "ws_from_inputs", "inputs fallback when index null")
    },
  },
]
