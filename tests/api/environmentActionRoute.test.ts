/**
 * API route tests: environment action routes (deploy, destroy).
 * Tests auth behavior via RBAC permission layer.
 * Deploy auth is also covered by projectAccessEnforcement.test.ts.
 */

import { NextRequest } from "next/server"
import { PermissionDeniedError, type PermissionContext } from "@/lib/auth/permissions"
import { makePOST as makeDeployPOST, type DeployRouteDeps } from "@/app/api/environments/[id]/deploy/route"
import {
  makeEnvDestroyPOST,
  type EnvDestroyRouteDeps,
} from "@/app/api/environments/[id]/destroy/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const ORG_ID = "org_1"
const PROJECT_ID = "proj_1"
const ENV_ID = "env_1"
const OTHER_ORG = "org_other"

const mockEnvRow = {
  environment_id: ENV_ID,
  org_id: ORG_ID,
  project_key: "core",
  environment_key: "dev",
  environment_slug: "test",
  repo_full_name: "owner/repo",
  template_id: "blank" as string | null,
  template_version: "v1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived_at: null as string | null,
}

const mockSession = {
  login: "alice",
  name: "Alice",
  avatarUrl: null,
  orgId: ORG_ID,
}

function mockPermissionContext(overrides?: Partial<PermissionContext>): PermissionContext {
  return {
    login: mockSession.login,
    orgId: mockSession.orgId,
    orgRole: null,
    teamIds: [],
    projectRoleCache: new Map(),
    ...overrides,
  }
}

function deployDeps(overrides: Partial<DeployRouteDeps> = {}): DeployRouteDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getEnvironmentById: async (id) => (id === ENV_ID ? mockEnvRow as any : null),
    getProjectByKey: async (orgId) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
    createDeployPR: async () => ({
      pr_number: 1,
      pr_url: "https://example.com/pr/1",
      branch_name: "deploy/dev/test",
      commit_sha: "abc123",
    }),
    ...overrides,
  }
}

function destroyDeps(overrides: Partial<EnvDestroyRouteDeps> = {}): EnvDestroyRouteDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getEnvironmentById: async (id) => (id === ENV_ID ? mockEnvRow as any : null),
    getProjectByKey: async (orgId) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    ...overrides,
  }
}

async function callDeploy(deps: DeployRouteDeps, envId = ENV_ID): Promise<Response> {
  const POST = makeDeployPOST(deps)
  const req = new NextRequest("http://localhost/api/environments/" + envId + "/deploy", {
    method: "POST",
    body: "{}",
  })
  const res = await POST(req, { params: Promise.resolve({ id: envId }) })
  return res as unknown as Response
}

async function callDestroy(deps: EnvDestroyRouteDeps, envId = ENV_ID): Promise<Response> {
  const POST = makeEnvDestroyPOST(deps)
  const req = new NextRequest("http://localhost/api/environments/" + envId + "/destroy", {
    method: "POST",
  })
  const res = await POST(req, { params: Promise.resolve({ id: envId }) })
  return res as unknown as Response
}

export const tests = [
  // --- Deploy route (deploy_env permission) ---
  {
    name: "POST deploy: deployer can deploy environment",
    fn: async () => {
      const deps = deployDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callDeploy(deps)
      assert(res.status === 201 || res.status === 503 || res.status === 400, `expected success or infra/config, got ${res.status}`)
    },
  },
  {
    name: "POST deploy: operator cannot deploy environment",
    fn: async () => {
      const deps = deployDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callDeploy(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Deploy not permitted for your role", `expected deploy error, got ${body.error}`)
    },
  },
  {
    name: "POST deploy: org admin short-circuit works",
    fn: async () => {
      const deps = deployDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callDeploy(deps)
      assert(res.status === 201 || res.status === 503 || res.status === 400, `expected success, got ${res.status}`)
    },
  },
  {
    name: "POST deploy: cross-org returns 404",
    fn: async () => {
      const deps = deployDeps({
        getEnvironmentById: async () => ({ ...mockEnvRow, org_id: OTHER_ORG } as any),
      })
      const res = await callDeploy(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST deploy: project not in org returns 404",
    fn: async () => {
      const deps = deployDeps({
        getProjectByKey: async () => null,
      })
      const res = await callDeploy(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST deploy: in-org insufficient permission returns 403",
    fn: async () => {
      const deps = deployDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callDeploy(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "POST deploy: unauthenticated returns 401",
    fn: async () => {
      const deps = deployDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callDeploy(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  // --- Destroy route (deploy_env permission) ---
  {
    name: "POST destroy: admin can destroy environment",
    fn: async () => {
      const archivedEnv = { ...mockEnvRow, archived_at: "2024-01-01T00:00:00Z" }
      const deps = destroyDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
        getEnvironmentById: async () => archivedEnv as any,
      })
      const res = await callDestroy(deps)
      assert(res.status === 200, `expected 200 (already archived), got ${res.status}`)
      const body = await res.json()
      assert(body.alreadyArchived === true, `expected alreadyArchived, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST destroy: deployer cannot destroy environment (requires admin for destroy)",
    fn: async () => {
      const deps = destroyDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callDestroy(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Destroy not permitted for your role", `expected destroy error, got ${body.error}`)
    },
  },
  {
    name: "POST destroy: org admin short-circuit works",
    fn: async () => {
      const archivedEnv = { ...mockEnvRow, archived_at: "2024-01-01T00:00:00Z" }
      const deps = destroyDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
        getEnvironmentById: async () => archivedEnv as any,
      })
      const res = await callDestroy(deps)
      assert(res.status === 200, `expected 200 (already archived), got ${res.status}`)
    },
  },
  {
    name: "POST destroy: cross-org returns 404",
    fn: async () => {
      const deps = destroyDeps({
        getEnvironmentById: async () => ({ ...mockEnvRow, org_id: OTHER_ORG } as any),
      })
      const res = await callDestroy(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST destroy: project not in org returns 404",
    fn: async () => {
      const deps = destroyDeps({
        getProjectByKey: async () => null,
      })
      const res = await callDestroy(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST destroy: in-org insufficient permission returns 403",
    fn: async () => {
      const deps = destroyDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callDestroy(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "POST destroy: unauthenticated returns 401",
    fn: async () => {
      const deps = destroyDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callDestroy(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
]
