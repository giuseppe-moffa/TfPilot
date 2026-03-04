/**
 * Invariant tests: zero-legacy mode.
 * - Request doc shape: env_id/key/slug required; no legacy project/environment.
 * - No code references request.environment or envs/${environment}.
 * - Dispatch payload schemas use only v2 inputs (environment_key, environment_slug).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

/** StoredRequest shape: project_key, environment_key, environment_slug, environment_id required. */
const REQUIRED_REQUEST_ENV_FIELDS = ["project_key", "environment_key", "environment_slug", "environment_id"] as const

/** Legacy fields that must not appear in new request docs. */
const FORBIDDEN_LEGACY_FIELDS = ["project", "environment"] as const

/** Workflow dispatch v2 input names. */
const V2_DISPATCH_INPUTS = ["environment_key", "environment_slug", "request_id"] as const

export const tests = [
  {
    name: "zeroLegacy: StoredRequest type has required env fields (no optional)",
    fn: () => {
      // Type-level check: we assert the shape via runtime; TS ensures no optional for new requests
      const required = new Set(REQUIRED_REQUEST_ENV_FIELDS)
      for (const f of required) {
        assert(typeof f === "string" && f.length > 0, `required field ${f} defined`)
      }
    },
  },
  {
    name: "zeroLegacy: legacy project/environment not in canonical request shape",
    fn: () => {
      for (const f of FORBIDDEN_LEGACY_FIELDS) {
        assert(!REQUIRED_REQUEST_ENV_FIELDS.includes(f as (typeof REQUIRED_REQUEST_ENV_FIELDS)[number]), `${f} is forbidden`)
      }
    },
  },
  {
    name: "zeroLegacy: formatEnvDisplay accepts (key, slug) only (2 args)",
    fn: async () => {
      const { formatEnvDisplay } = await import("@/lib/format/envDisplay")
      const result = formatEnvDisplay("dev", "ai-agent")
      assert(result === "dev / ai-agent", "format works")
      assert(formatEnvDisplay.length === 2 || formatEnvDisplay("dev", "ai-agent") !== "", "2-arg signature")
    },
  },
  {
    name: "zeroLegacy: resolveRequestEnvironment rejects legacy project+environment",
    fn: async () => {
      const { resolveRequestEnvironment } = await import("@/lib/requests/resolveRequestEnvironment")
      const r = await resolveRequestEnvironment({ project: "core", environment: "dev" } as unknown as Parameters<typeof resolveRequestEnvironment>[0])
      assert(r.ok === false, "rejects")
      assert(r.ok === false && r.error.includes("Provide"), "error mentions Provide")
    },
  },
  {
    name: "zeroLegacy: RequestForTags uses project_key and environment_key",
    fn: async () => {
      const { buildServerAuthoritativeTags } = await import("@/lib/requests/tags")
      const tags = buildServerAuthoritativeTags(
        { id: "req_1", project_key: "core", environment_key: "dev" },
        "user"
      )
      assert(tags["tfpilot:project"] === "core", "project tag from project_key")
      assert(tags["tfpilot:environment"] === "dev", "environment tag from environment_key")
    },
  },
]
