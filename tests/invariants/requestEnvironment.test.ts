/**
 * Invariant tests: Request create body validation, workspace resolution, immutability.
 * Workspace-first; uses resolveRequestWorkspace and assertWorkspaceImmutability.
 */

import { validateCreateBody } from "@/lib/requests/validateCreateBody"
import { assertWorkspaceImmutability } from "@/lib/requests/assertWorkspaceImmutability"
import { resolveRequestWorkspace } from "@/lib/requests/resolveRequestWorkspace"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockWs = {
  workspace_id: "ws_abc",
  org_id: "org_default",
  project_key: "core",
  repo_full_name: "owner/core-terraform",
  workspace_key: "dev",
  workspace_slug: "ai-agent",
  template_id: "baseline",
  template_version: "v1",
  template_inputs: {},
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  archived_at: null,
}

const mockWsArchived = { ...mockWs, archived_at: "2025-01-02T00:00:00Z" }

export const tests = [
  {
    name: "validateCreateBody: accepts workspace_id only",
    fn: () => {
      const errors = validateCreateBody({
        workspace_id: "ws_abc",
        module: "s3-bucket",
        config: { name: "test" },
      })
      assert(errors.length === 0, "no errors")
    },
  },
  {
    name: "validateCreateBody: accepts project_key + workspace_key + workspace_slug",
    fn: () => {
      const errors = validateCreateBody({
        project_key: "core",
        workspace_key: "dev",
        workspace_slug: "ai-agent",
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
      assert(errors.length > 0 && errors.some((e) => e.includes("workspace_id") || e.includes("project_key")), "legacy rejected")
    },
  },
  {
    name: "validateCreateBody: rejects when no workspace ref provided",
    fn: () => {
      const errors = validateCreateBody({
        module: "s3-bucket",
        config: {},
      })
      assert(errors.length > 0 && errors.some((e) => e.includes("workspace")), "workspace ref required")
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
    name: "resolveRequestWorkspace: workspace_id with mock — found",
    fn: async () => {
      const r = await resolveRequestWorkspace({
        workspace_id: "ws_abc",
        orgId: "org_default",
        _deps: {
          getWorkspaceById: async (id) => (id === "ws_abc" ? mockWs : null),
          getWorkspaceByRepoKeySlug: async () => null,
          getProjectByKey: async () => ({ repoFullName: "owner/core-terraform", defaultBranch: "main" }),
        },
      })
      assert(r.ok === true, "resolves")
      assert(r.ok && r.resolved.workspace_id === "ws_abc", "workspace_id")
      assert(r.ok && r.resolved.workspace_slug === "ai-agent", "slug")
    },
  },
  {
    name: "resolveRequestWorkspace: workspace_id — archived rejected",
    fn: async () => {
      const r = await resolveRequestWorkspace({
        workspace_id: "ws_archived",
        orgId: "org_default",
        _deps: {
          getWorkspaceById: async () => mockWsArchived,
          getWorkspaceByRepoKeySlug: async () => null,
          getProjectByKey: async () => ({ repoFullName: "owner/core-terraform", defaultBranch: "main" }),
        },
      })
      assert(r.ok === false && r.error.includes("archived"), "archived rejected")
    },
  },
  {
    name: "resolveRequestWorkspace: workspace_id — not found",
    fn: async () => {
      const r = await resolveRequestWorkspace({
        workspace_id: "ws_nonexistent",
        orgId: "org_default",
        _deps: {
          getWorkspaceById: async () => null,
          getWorkspaceByRepoKeySlug: async () => null,
          getProjectByKey: async () => null,
        },
      })
      assert(r.ok === false && r.error.includes("not found"), "not found")
    },
  },
  {
    name: "resolveRequestWorkspace: both workspace_id and key+slug matching",
    fn: async () => {
      const r = await resolveRequestWorkspace({
        workspace_id: "ws_abc",
        project_key: "core",
        workspace_key: "dev",
        workspace_slug: "ai-agent",
        orgId: "org_default",
        _deps: {
          getWorkspaceById: async () => mockWs,
          getWorkspaceByRepoKeySlug: async () => null,
          getProjectByKey: async () => ({ repoFullName: "owner/core-terraform", defaultBranch: "main" }),
        },
      })
      assert(r.ok === true, "match succeeds")
    },
  },
  {
    name: "resolveRequestWorkspace: both workspace_id and key+slug mismatching",
    fn: async () => {
      const r = await resolveRequestWorkspace({
        workspace_id: "ws_abc",
        project_key: "core",
        workspace_key: "prod",
        workspace_slug: "wrong",
        orgId: "org_default",
        _deps: {
          getWorkspaceById: async () => mockWs,
          getWorkspaceByRepoKeySlug: async () => null,
          getProjectByKey: async () => ({ repoFullName: "owner/core-terraform", defaultBranch: "main" }),
        },
      })
      assert(r.ok === false && r.error.includes("match"), "mismatch rejected")
    },
  },
  {
    name: "assertWorkspaceImmutability: allows patch without workspace fields",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { name: "newname" })
      assert(err === null, "no error")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects change to workspace_id",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev" }
      const err = assertWorkspaceImmutability(current, { workspace_id: "ws_2" })
      assert(err === "workspace_id is immutable", "rejects workspace_id change")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects change to workspace_key",
    fn: () => {
      const current = { workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, { workspace_key: "prod" })
      assert(err === "workspace_key is immutable", "rejects key change")
    },
  },
  {
    name: "assertWorkspaceImmutability: rejects change to workspace_slug",
    fn: () => {
      const current = { workspace_key: "dev", workspace_slug: "ai-agent" }
      const err = assertWorkspaceImmutability(current, { workspace_slug: "other" })
      assert(err === "workspace_slug is immutable", "rejects slug change")
    },
  },
  {
    name: "assertWorkspaceImmutability: allows same values (no change)",
    fn: () => {
      const current = { workspace_id: "ws_1", workspace_key: "dev", workspace_slug: "x" }
      const err = assertWorkspaceImmutability(current, {
        workspace_id: "ws_1",
        workspace_key: "dev",
        workspace_slug: "x",
      })
      assert(err === null, "same values allowed")
    },
  },
]
