/**
 * Invariant tests: Request create body validation, environment resolution, immutability.
 * Phase 4 staged — Model 2 fields accepted, execution still Model 1.
 */

import { validateCreateBody } from "@/lib/requests/validateCreateBody"
import { assertEnvironmentImmutability } from "@/lib/requests/assertEnvironmentImmutability"
import { resolveRequestEnvironment } from "@/lib/requests/resolveRequestEnvironment"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockEnv = {
  environment_id: "env_abc",
  project_key: "core",
  repo_full_name: "owner/core-terraform",
  environment_key: "dev",
  environment_slug: "ai-agent",
  template_id: null,
  template_version: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  archived_at: null,
}

const mockEnvArchived = { ...mockEnv, archived_at: "2025-01-02T00:00:00Z" }

export const tests = [
  {
    name: "validateCreateBody: accepts environment_id only",
    fn: () => {
      const errors = validateCreateBody({
        environment_id: "env_abc",
        module: "s3-bucket",
        config: { name: "test" },
      })
      assert(errors.length === 0, "no errors")
    },
  },
  {
    name: "validateCreateBody: accepts project_key + environment_key + environment_slug",
    fn: () => {
      const errors = validateCreateBody({
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
        module: "ecr-repo",
        config: {},
      })
      assert(errors.length === 0, "no errors")
    },
  },
  {
    name: "validateCreateBody: rejects legacy project + environment (Model 2 only)",
    fn: () => {
      const errors = validateCreateBody({
        project: "core",
        environment: "dev",
        module: "s3-bucket",
        config: {},
      })
      assert(errors.length > 0 && errors.some((e) => e.includes("environment_id") || e.includes("project_key")), "legacy rejected")
    },
  },
  {
    name: "validateCreateBody: rejects when no env ref provided",
    fn: () => {
      const errors = validateCreateBody({
        module: "s3-bucket",
        config: {},
      })
      assert(errors.length > 0 && errors.some((e) => e.includes("environment")), "env ref required")
    },
  },
  {
    name: "validateCreateBody: rejects when module missing",
    fn: () => {
      const errors = validateCreateBody({
        project: "core",
        environment: "dev",
        config: {},
      })
      assert(errors.some((e) => e.includes("module")), "module required")
    },
  },
  {
    name: "validateCreateBody: rejects when config missing",
    fn: () => {
      const errors = validateCreateBody({
        project: "core",
        environment: "dev",
        module: "s3-bucket",
      })
      assert(errors.some((e) => e.includes("config")), "config required")
    },
  },
  {
    name: "resolveRequestEnvironment: environment_id with mock — found",
    fn: async () => {
      const r = await resolveRequestEnvironment({
        environment_id: "env_abc",
        _deps: {
          getEnvironmentById: async (id) => (id === "env_abc" ? mockEnv : null),
          getEnvironmentByRepoKeySlug: async () => null,
        },
      })
      assert(r.ok === true, "resolves")
      assert(r.ok && r.resolved.environment_id === "env_abc", "environment_id")
      assert(r.ok && r.resolved.environment_slug === "ai-agent", "slug")
    },
  },
  {
    name: "resolveRequestEnvironment: environment_id — archived rejected",
    fn: async () => {
      const r = await resolveRequestEnvironment({
        environment_id: "env_archived",
        _deps: {
          getEnvironmentById: async () => mockEnvArchived,
          getEnvironmentByRepoKeySlug: async () => null,
        },
      })
      assert(r.ok === false && r.error.includes("archived"), "archived rejected")
    },
  },
  {
    name: "resolveRequestEnvironment: environment_id — not found",
    fn: async () => {
      const r = await resolveRequestEnvironment({
        environment_id: "env_nonexistent",
        _deps: {
          getEnvironmentById: async () => null,
          getEnvironmentByRepoKeySlug: async () => null,
        },
      })
      assert(r.ok === false && r.error.includes("not found"), "not found")
    },
  },
  {
    name: "resolveRequestEnvironment: both env_id and key+slug matching",
    fn: async () => {
      const r = await resolveRequestEnvironment({
        environment_id: "env_abc",
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
        _deps: {
          getEnvironmentById: async () => mockEnv,
          getEnvironmentByRepoKeySlug: async () => null,
        },
      })
      assert(r.ok === true, "match succeeds")
    },
  },
  {
    name: "resolveRequestEnvironment: both env_id and key+slug mismatching",
    fn: async () => {
      const r = await resolveRequestEnvironment({
        environment_id: "env_abc",
        project_key: "core",
        environment_key: "prod",
        environment_slug: "wrong",
        _deps: {
          getEnvironmentById: async () => mockEnv,
          getEnvironmentByRepoKeySlug: async () => null,
        },
      })
      assert(r.ok === false && r.error.includes("match"), "mismatch rejected")
    },
  },
  {
    name: "assertEnvironmentImmutability: allows patch without env fields",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { name: "newname" })
      assert(err === null, "no error")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects change to environment_id",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev" }
      const err = assertEnvironmentImmutability(current, { environment_id: "env_2" })
      assert(err === "environment_id is immutable", "rejects env_id change")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects change to environment_key",
    fn: () => {
      const current = { environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, { environment_key: "prod" })
      assert(err === "environment_key is immutable", "rejects key change")
    },
  },
  {
    name: "assertEnvironmentImmutability: rejects change to environment_slug",
    fn: () => {
      const current = { environment_key: "dev", environment_slug: "ai-agent" }
      const err = assertEnvironmentImmutability(current, { environment_slug: "other" })
      assert(err === "environment_slug is immutable", "rejects slug change")
    },
  },
  {
    name: "assertEnvironmentImmutability: allows same values (no change)",
    fn: () => {
      const current = { environment_id: "env_1", environment_key: "dev", environment_slug: "x" }
      const err = assertEnvironmentImmutability(current, {
        environment_id: "env_1",
        environment_key: "dev",
        environment_slug: "x",
      })
      assert(err === null, "same values allowed")
    },
  },
]
