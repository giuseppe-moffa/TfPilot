/**
 * Invariant tests: Model 2 environment helpers (validateEnvironmentSlug, computeEnvRoot, resolveEnvironmentRef).
 * Phase 0 scaffolding. Pure functions, no network.
 */

import {
  validateEnvironmentSlug,
  computeEnvRoot,
  resolveEnvironmentRef,
  validateCreateEnvironmentBody,
} from "@/lib/environments/helpers"
import { PG_UNIQUE_VIOLATION } from "@/lib/db/environments"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockLookup = async (id: string) => {
  if (id === "env_abc123") return { environment_key: "dev", environment_slug: "ai-agent" }
  if (id === "env_prod1") return { environment_key: "prod", environment_slug: "payments" }
  return null
}

export const tests = [
  {
    name: "validateEnvironmentSlug: accepts valid slug",
    fn: () => {
      assert(validateEnvironmentSlug("ai-agent").ok === true, "valid slug")
      assert(validateEnvironmentSlug("feature-123").ok === true, "valid slug with numbers")
      assert(validateEnvironmentSlug("a").ok === true, "single letter")
    },
  },
  {
    name: "validateEnvironmentSlug: rejects uppercase",
    fn: () => {
      const r = validateEnvironmentSlug("AI-Agent")
      assert(r.ok === false && r.error.includes("lowercase"), "must be lowercase")
    },
  },
  {
    name: "validateEnvironmentSlug: rejects spaces",
    fn: () => {
      const r = validateEnvironmentSlug("ai agent")
      assert(r.ok === false && r.error.includes("spaces"), "no spaces")
    },
  },
  {
    name: "validateEnvironmentSlug: rejects underscores",
    fn: () => {
      const r = validateEnvironmentSlug("ai_agent")
      assert(r.ok === false && r.error.includes("underscores"), "no underscores")
    },
  },
  {
    name: "validateEnvironmentSlug: rejects slug > 63 chars",
    fn: () => {
      const r = validateEnvironmentSlug("a".repeat(64))
      assert(r.ok === false && r.error.includes("63"), "max 63 chars")
    },
  },
  {
    name: "validateEnvironmentSlug: rejects slug starting with number",
    fn: () => {
      const r = validateEnvironmentSlug("123agent")
      assert(r.ok === false && r.error.includes("letter"), "must start with letter")
    },
  },
  {
    name: "computeEnvRoot: returns correct path",
    fn: () => {
      assert(computeEnvRoot("dev", "ai-agent") === "envs/dev/ai-agent", "dev/ai-agent")
      assert(computeEnvRoot("prod", "payments") === "envs/prod/payments", "prod/payments")
    },
  },
  {
    name: "resolveEnvironmentRef: accepts environment_id only with lookup",
    fn: async () => {
      const r = await resolveEnvironmentRef({ environment_id: "env_abc123" }, mockLookup)
      assert(r.ok === true && r.ref.environment_key === "dev" && r.ref.environment_slug === "ai-agent", "resolved from id")
    },
  },
  {
    name: "resolveEnvironmentRef: accepts (key, slug) only",
    fn: async () => {
      const r = await resolveEnvironmentRef({ environment_key: "dev", environment_slug: "ai-agent" })
      assert(r.ok === true && r.ref.environment_key === "dev" && r.ref.environment_slug === "ai-agent", "key+slug only")
    },
  },
  {
    name: "resolveEnvironmentRef: validates match when both provided",
    fn: async () => {
      const r = await resolveEnvironmentRef(
        { environment_id: "env_abc123", environment_key: "dev", environment_slug: "ai-agent" },
        mockLookup
      )
      assert(r.ok === true, "match succeeds")
    },
  },
  {
    name: "resolveEnvironmentRef: rejects mismatch when both provided",
    fn: async () => {
      const r = await resolveEnvironmentRef(
        { environment_id: "env_abc123", environment_key: "prod", environment_slug: "wrong" },
        mockLookup
      )
      assert(r.ok === false && r.error.includes("match"), "mismatch rejected")
    },
  },
  {
    name: "resolveEnvironmentRef: rejects when environment_id not found",
    fn: async () => {
      const r = await resolveEnvironmentRef({ environment_id: "env_nonexistent" }, mockLookup)
      assert(r.ok === false && r.error.includes("not found"), "not found")
    },
  },
  {
    name: "resolveEnvironmentRef: requires lookup when only environment_id",
    fn: async () => {
      const r = await resolveEnvironmentRef({ environment_id: "env_abc123" })
      assert(r.ok === false && r.error.includes("lookup"), "requires lookup")
    },
  },
  {
    name: "resolveEnvironmentRef: requires id or key+slug",
    fn: async () => {
      const r = await resolveEnvironmentRef({})
      assert(r.ok === false && r.error.includes("Provide"), "empty input rejected")
    },
  },
  {
    name: "validateCreateEnvironmentBody: accepts valid body",
    fn: () => {
      const r = validateCreateEnvironmentBody({
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
      })
      assert(r === null, "valid body")
    },
  },
  {
    name: "validateCreateEnvironmentBody: rejects missing project_key",
    fn: () => {
      const r = validateCreateEnvironmentBody({
        environment_key: "dev",
        environment_slug: "ai-agent",
      })
      assert(Array.isArray(r) && r.some((e) => e.includes("project_key")), "missing project_key")
    },
  },
  {
    name: "validateCreateEnvironmentBody: rejects invalid environment_key",
    fn: () => {
      const r = validateCreateEnvironmentBody({
        project_key: "core",
        environment_key: "staging",
        environment_slug: "ai-agent",
      })
      assert(Array.isArray(r) && r.some((e) => e.includes("dev or prod")), "invalid environment_key")
    },
  },
  {
    name: "validateCreateEnvironmentBody: rejects invalid slug",
    fn: () => {
      const r = validateCreateEnvironmentBody({
        project_key: "core",
        environment_key: "dev",
        environment_slug: "AI-Agent",
      })
      assert(Array.isArray(r) && r.some((e) => e.includes("lowercase")), "invalid slug")
    },
  },
  {
    name: "PG_UNIQUE_VIOLATION: constant for duplicate env detection",
    fn: () => {
      assert(PG_UNIQUE_VIOLATION === "23505", "Postgres unique_violation code")
    },
  },
]
