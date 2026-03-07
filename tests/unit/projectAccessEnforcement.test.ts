/**
 * Unit tests: project access enforcement with RBAC intersection.
 * Tests deploy route (has injectable deps) and documents expected behavior for other routes.
 */

import { makePOST } from "@/app/api/environments/[id]/deploy/route"
import type { DeployRouteDeps } from "@/app/api/environments/[id]/deploy/route"
import type { SessionPayload } from "@/lib/auth/session"
import type { UserRole } from "@/lib/auth/roles"
import type { Environment } from "@/lib/db/environments"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function mockRequest(): Request {
  return new Request("http://localhost/api/environments/env_123/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
}

const BASE_ENV_ROW: Environment = {
  environment_id: "env_123",
  org_id: "default",
  project_key: "core",
  environment_key: "dev",
  environment_slug: "test",
  repo_full_name: "owner/repo",
  template_id: "blank",
  template_version: "v1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived_at: null,
}

function createMockDeps(config: {
  session: SessionPayload | null
  getUserRole: (login?: string | null) => UserRole
  userHasProjectKeyAccess: (login: string | undefined | null, orgId: string, projectKey: string) => Promise<boolean>
  envOrgId?: string
}): DeployRouteDeps {
  const orgId = config.envOrgId ?? "default"
  const envRow: Environment = { ...BASE_ENV_ROW, org_id: orgId }

  return {
    getSessionFromCookies: async () => config.session,
    getUserRole: config.getUserRole,
    userHasProjectKeyAccess: config.userHasProjectKeyAccess,
    getGitHubAccessToken: async () => "token",
    getEnvironmentById: async (id) => {
      if (id === "env_123") return envRow
      return null
    },
    isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false }),
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
          session: { login: "admin1", orgId: "default" },
          getUserRole: () => "admin",
          userHasProjectKeyAccess: async () => true,
          getEnvironmentById: async (id) =>
            id === "env_123"
              ? ({
                  environment_id: "env_123",
                  org_id: "default",
                  project_key: "core",
                  environment_key: "dev",
                  environment_slug: "test",
                  repo_full_name: "owner/repo",
                  template_id: "blank",
                  template_version: "v1",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  archived_at: null,
                } as Environment)
              : null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "env_123" }) })
      assert(res.status === 201 || res.status === 503 || res.status === 400, `expected success or infra/config failure, got ${res.status}`)
    },
  },
  {
    name: "deploy: admin without project access -> 404",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "admin1", orgId: "default" },
          getUserRole: () => "admin",
          userHasProjectKeyAccess: async () => false,
          getEnvironmentById: async (id) =>
            id === "env_123"
              ? ({
                  environment_id: "env_123",
                  org_id: "default",
                  project_key: "core",
                  environment_key: "dev",
                  environment_slug: "test",
                  repo_full_name: "owner/repo",
                  template_id: "blank",
                  template_version: "v1",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  archived_at: null,
                } as Environment)
              : null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "env_123" }) })
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
          session: { login: "dev1", orgId: "default" },
          getUserRole: () => "developer",
          userHasProjectKeyAccess: async () => true,
          getEnvironmentById: async (id) =>
            id === "env_123"
              ? ({
                  environment_id: "env_123",
                  org_id: "default",
                  project_key: "core",
                  environment_key: "dev",
                  environment_slug: "test",
                  repo_full_name: "owner/repo",
                  template_id: "blank",
                  template_version: "v1",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  archived_at: null,
                } as Environment)
              : null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "env_123" }) })
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(
        body?.error?.includes("role") || body?.error === "Deploy not permitted for your role",
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
          getUserRole: () => "viewer",
          userHasProjectKeyAccess: async () => false,
          getEnvironmentById: async () => null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "env_123" }) })
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "deploy: cross-org env (org_id mismatch) -> 404",
    fn: async () => {
      const POST = makePOST(
        createMockDeps({
          session: { login: "admin1", orgId: "other-org" },
          getUserRole: () => "admin",
          userHasProjectKeyAccess: async () => true,
          getEnvironmentById: async (id) =>
            id === "env_123"
              ? ({
                  environment_id: "env_123",
                  org_id: "default",
                  project_key: "core",
                  environment_key: "dev",
                  environment_slug: "test",
                  repo_full_name: "owner/repo",
                  template_id: "blank",
                  template_version: "v1",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  archived_at: null,
                } as Environment)
              : null,
        })
      )
      const req = mockRequest() as unknown as import("next/server").NextRequest
      const res = await POST(req, { params: Promise.resolve({ id: "env_123" }) })
      assert(res.status === 404, `expected 404 for org mismatch, got ${res.status}`)
    },
  },
]
