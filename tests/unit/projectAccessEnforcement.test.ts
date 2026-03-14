/**
 * Unit tests: project access enforcement with RBAC intersection.
 * Tests workspace deploy route (has injectable deps) and documents expected behavior for other routes.
 */

import { makePOST } from "@/app/api/workspaces/[id]/deploy/route"
import type { DeployRouteDeps } from "@/app/api/workspaces/[id]/deploy/route"
import type { SessionPayload } from "@/lib/auth/session"
import type { Workspace } from "@/lib/db/workspaces"
import { PermissionDeniedError } from "@/lib/auth/permissions"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function mockRequest(): Request {
  return new Request("http://localhost/api/workspaces/ws_123/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
}

const BASE_WS_ROW: Workspace = {
  workspace_id: "ws_123",
  org_id: "default",
  project_key: "core",
  workspace_key: "dev",
  workspace_slug: "test",
  repo_full_name: "owner/repo",
  template_id: "baseline",
  template_version: "v1",
  template_inputs: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived_at: null,
}

const PROJECT_ID = "proj_1"

function createMockDeps(config: {
  session: SessionPayload | null
  projectAccess: boolean
  deployAllowed: boolean
  wsOrgId?: string
  getWorkspaceById?: (id: string) => Promise<Workspace | null>
}): DeployRouteDeps {
  const orgId = config.wsOrgId ?? "default"
  const wsRow: Workspace = { ...BASE_WS_ROW, org_id: orgId }
  const getWs = config.getWorkspaceById ?? (async (id: string) => (id === "ws_123" ? wsRow : null))

  return {
    getSessionFromCookies: async () => config.session,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getWorkspaceById: getWs,
    getProjectByKey: async (oId, _key) =>
      config.projectAccess && oId === orgId ? { id: PROJECT_ID, orgId: oId } : null,
    buildPermissionContext: async () => ({
      login: config.session?.login ?? "",
      orgId: orgId,
      orgRole: config.deployAllowed ? ("admin" as const) : null,
      teamIds: [],
      projectRoleCache: new Map(),
    }),
    requireProjectPermission: async () => {
      if (!config.deployAllowed) throw new PermissionDeniedError()
    },
    isWorkspaceDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
    createDeployPR: async () => ({
      pr_number: 1,
      pr_url: "https://example.com/pr/1",
      branch_name: "deploy/dev/test",
      commit_sha: "abc123",
    }),
  }
}

export const tests = [
  {
    name: "deploy: admin + project access -> allowed (proceeds past RBAC and project checks)",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "admin1", name: "Admin", avatarUrl: null, orgId: "default" },
          projectAccess: true,
          deployAllowed: true,
          getWorkspaceById: async (id: string) => (id === "ws_123" ? BASE_WS_ROW : null),
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(
        res.status === 201 || res.status === 503 || res.status === 400 || res.status === 500,
        `expected success, 503, 400, or 500 (template missing), got ${res.status}`
      )
    },
  },
  {
    name: "deploy: admin without project access -> 404",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "admin1", name: "Admin", avatarUrl: null, orgId: "default" },
          projectAccess: false,
          deployAllowed: true,
          getWorkspaceById: async (id: string) => (id === "ws_123" ? BASE_WS_ROW : null),
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(res.status === 404, `expected 404, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "Not found", `expected error "Not found", got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "deploy: developer with project access -> 403 (RBAC denies before project check)",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "dev1", name: "Dev", avatarUrl: null, orgId: "default" },
          projectAccess: true,
          deployAllowed: false,
          getWorkspaceById: async (id: string) => (id === "ws_123" ? BASE_WS_ROW : null),
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(
        body?.error?.includes("role") || body?.error === "Deploy not permitted for your role",
        `expected role error, got ${JSON.stringify(body)}`
      )
    },
  },
  {
    name: "deploy: operator with project access -> 403 (deploy denied)",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "op1", name: "Operator", avatarUrl: null, orgId: "default" },
          projectAccess: true,
          deployAllowed: false,
          getWorkspaceById: async (id: string) => (id === "ws_123" ? BASE_WS_ROW : null),
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(
        body?.error === "Deploy not permitted for your role",
        `expected role error, got ${JSON.stringify(body)}`
      )
    },
  },
  {
    name: "deploy: unauthenticated -> 401",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: null,
          projectAccess: false,
          deployAllowed: false,
          getWorkspaceById: async () => null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "deploy: cross-org workspace (org_id mismatch) -> 404",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "admin1", name: "Admin", avatarUrl: null, orgId: "other-org" },
          projectAccess: true,
          deployAllowed: true,
          getWorkspaceById: async (id: string) => (id === "ws_123" ? { ...BASE_WS_ROW, org_id: "default" } : null),
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "ws_123" }) })
      assert(res.status === 404, `expected 404 for org mismatch, got ${res.status}`)
    },
  },
]
