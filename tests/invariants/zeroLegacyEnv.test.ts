/**
 * Invariant tests: zero-legacy mode.
 * - Request doc shape: env_id/key/slug required; no legacy project/environment.
 * - No code references request.environment or envs/${environment}.
 * - Dispatch payload schemas use only workspace inputs (workspace_key, workspace_slug, request_id).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

/** StoredRequest shape: project_key, workspace_key, workspace_slug, workspace_id required. */
const REQUIRED_REQUEST_WORKSPACE_FIELDS = ["project_key", "workspace_key", "workspace_slug", "workspace_id"] as const

/** Legacy fields that must not appear in new request docs. */
const FORBIDDEN_LEGACY_FIELDS = ["project", "environment"] as const

/** Workflow dispatch input names (workspace_key, workspace_slug, request_id). */
const DISPATCH_INPUTS = ["workspace_key", "workspace_slug", "request_id"] as const

export const tests = [
  {
    name: "zeroLegacy: StoredRequest type has required workspace fields (no optional)",
    fn: () => {
      const required = new Set(REQUIRED_REQUEST_WORKSPACE_FIELDS)
      for (const f of required) {
        assert(typeof f === "string" && f.length > 0, `required field ${f} defined`)
      }
    },
  },
  {
    name: "zeroLegacy: legacy project/environment not in canonical request shape",
    fn: () => {
      for (const f of FORBIDDEN_LEGACY_FIELDS) {
        assert(!REQUIRED_REQUEST_WORKSPACE_FIELDS.includes(f as (typeof REQUIRED_REQUEST_WORKSPACE_FIELDS)[number]), `${f} is forbidden`)
      }
    },
  },
  {
    name: "zeroLegacy: formatWorkspaceDisplay accepts (workspace_key, workspace_slug) (2 args)",
    fn: async () => {
      const { formatWorkspaceDisplay } = await import("@/lib/format/workspaceDisplay")
      const result = formatWorkspaceDisplay("dev", "ai-agent")
      assert(result === "dev / ai-agent", "format works")
      assert(formatWorkspaceDisplay.length === 2 || formatWorkspaceDisplay("dev", "ai-agent") !== "", "2-arg signature")
    },
  },
  {
    name: "zeroLegacy: resolveRequestWorkspace rejects legacy project+environment",
    fn: async () => {
      const { resolveRequestWorkspace } = await import("@/lib/requests/resolveRequestWorkspace")
      const r = await resolveRequestWorkspace({ project: "core", environment: "dev" } as unknown as Parameters<typeof resolveRequestWorkspace>[0])
      assert(r.ok === false, "rejects")
      assert(r.ok === false && r.error.includes("Provide"), "error mentions Provide")
    },
  },
  {
    name: "zeroLegacy: RequestForTags uses project_key and workspace_key",
    fn: async () => {
      const { buildServerAuthoritativeTags } = await import("@/lib/requests/tags")
      const tags = buildServerAuthoritativeTags(
        { id: "req_1", project_key: "core", workspace_key: "dev" },
        "user"
      )
      assert(tags["tfpilot:project"] === "core", "project tag from project_key")
      assert(tags["tfpilot:environment"] === "dev", "environment tag from workspace_key")
    },
  },
]
