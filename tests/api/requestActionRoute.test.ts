/**
 * API route tests: request action routes (approve, apply, destroy, create/plan).
 * Tests auth behavior via RBAC permission layer.
 */

import { NextRequest } from "next/server"
import { PermissionDeniedError, type PermissionContext } from "@/lib/auth/permissions"
import {
  makeRequestApprovePOST,
  type RequestApproveDeps,
} from "@/app/api/requests/[requestId]/approve/route"
import {
  makeDestroyPOST,
  type DestroyRouteDeps,
} from "@/app/api/requests/[requestId]/destroy/route"
import {
  makeApplyPOST,
  type ApplyRouteDeps,
} from "@/app/api/requests/[requestId]/apply/route"
import {
  makeRequestsPOST,
  type RequestsPOSTDeps,
} from "@/app/api/requests/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const ORG_ID = "org_1"
const PROJECT_ID = "proj_1"
const REQUEST_ID = "req_1"
const OTHER_ORG = "org_other"

const mockRequest = {
  id: REQUEST_ID,
  org_id: ORG_ID,
  project_key: "myproj",
  targetOwner: "owner",
  targetRepo: "repo",
  prNumber: 1,
  environment_key: "dev",
  environment_id: "env_1",
  environment_slug: "test",
  targetEnvPath: "envs/dev/test",
  targetBase: "main",
  timeline: [],
  approval: { approved: false, approvers: [] },
}

const mockRequestForDestroy = {
  ...mockRequest,
  runs: {
    destroy: { runId: 1, url: "https://example.com/run/1", status: "completed", conclusion: "success" },
  },
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

function approveDeps(overrides: Partial<RequestApproveDeps> = {}): RequestApproveDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getRequest: async () => mockRequest,
    getRequestOrgId: async () => ORG_ID,
    getProjectByKey: async (orgId, _key) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    getGitHubAccessToken: async () => "token",
    gh: async () => ({}),
    getIdempotencyKey: () => "key",
    assertIdempotentOrRecord: async () => ({
      ok: true,
      mode: "recorded",
      patch: { idempotency: { approve: { key: "key", at: new Date().toISOString() } } },
    }),
    updateRequest: async () => [mockRequest],
    logLifecycleEvent: async () => {},
    writeAuditEvent: async () => {},
    ...overrides,
  }
}

async function callApprove(
  deps: RequestApproveDeps,
  requestId = REQUEST_ID
): Promise<Response> {
  const POST = makeRequestApprovePOST(deps)
  const req = new NextRequest("http://localhost/api/requests/" + requestId + "/approve", {
    method: "POST",
  })
  const res = await POST(req, { params: Promise.resolve({ requestId }) })
  return res as unknown as Response
}

function destroyDeps(overrides: Partial<DestroyRouteDeps> = {}): DestroyRouteDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getRequest: async () => mockRequestForDestroy,
    getRequestOrgId: async () => ORG_ID,
    getProjectByKey: async (orgId, _key) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    getIdempotencyKey: () => "key",
    assertIdempotentOrRecord: () => ({ ok: false, mode: "replay" }),
    updateRequest: async () => [mockRequestForDestroy],
    ...overrides,
  }
}

async function callDestroy(
  deps: DestroyRouteDeps,
  requestId = REQUEST_ID
): Promise<Response> {
  const POST = makeDestroyPOST(deps)
  const req = new NextRequest("http://localhost/api/requests/" + requestId + "/destroy", {
    method: "POST",
  })
  const res = await POST(req, { params: Promise.resolve({ requestId }) })
  return res as unknown as Response
}

function applyDeps(overrides: Partial<ApplyRouteDeps> = {}): ApplyRouteDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getRequest: async () => mockRequest,
    getRequestOrgId: async () => ORG_ID,
    getProjectByKey: async (orgId, _key) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    getIdempotencyKey: () => "key",
    assertIdempotentOrRecord: () => ({ ok: false, mode: "replay" }),
    updateRequest: async () => [mockRequest],
    ...overrides,
  }
}

async function callApply(
  deps: ApplyRouteDeps,
  requestId = REQUEST_ID,
  body?: { suggestionIds?: string[] }
): Promise<Response> {
  const POST = makeApplyPOST(deps)
  const req = new NextRequest("http://localhost/api/requests/" + requestId + "/apply", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await POST(req, { params: Promise.resolve({ requestId }) })
  return res as unknown as Response
}

const resolvedEnvForCreate = {
  project_key: "myproj",
  environment_key: "dev",
  environment_slug: "test",
  environment_id: "env_1",
  targetRepo: { owner: "owner", repo: "repo", base: "main", envPath: "envs/dev/test" },
}

const createPlanBody = {
  project_key: "myproj",
  environment_key: "dev",
  environment_slug: "test",
  module: "s3-bucket",
  config: { name: "test" },
}

function requestsPOSTDeps(overrides: Partial<RequestsPOSTDeps> = {}): RequestsPOSTDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getGitHubAccessToken: async () => "token",
    getIdempotencyKey: () => null,
    checkCreateIdempotency: () => ({ ok: true, mode: "new" }),
    resolveRequestEnvironment: async () => ({ ok: true, resolved: resolvedEnvForCreate }),
    getProjectByKey: async (orgId) =>
      orgId === ORG_ID ? { id: PROJECT_ID, orgId: ORG_ID } : null,
    buildPermissionContext: async () => mockPermissionContext(),
    requireProjectPermission: async () => null,
    generateModel2TerraformFiles: async () => ({ files: [{ path: "envs/dev/test/request_x.tf", content: "# mock" }] }),
    createBranchCommitPrAndPlan: async () => ({
      branchName: "request/x",
      prNumber: 1,
      prUrl: "https://example.com/pr/1",
      commitSha: "sha",
      planHeadSha: "sha",
      baseSha: "base",
    }),
    saveRequest: async () => {},
    recordCreate: () => {},
    ...overrides,
  }
}

async function callCreatePlan(
  deps: RequestsPOSTDeps,
  body: Record<string, unknown> = createPlanBody
): Promise<Response> {
  const POST = makeRequestsPOST(deps)
  const req = new NextRequest("http://localhost/api/requests", {
    method: "POST",
    body: JSON.stringify(body),
  })
  const res = await POST(req)
  return res as unknown as Response
}

export const tests = [
  {
    name: "POST approve: operator can approve",
    fn: async () => {
      const deps = approveDeps()
      const res = await callApprove(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST approve: planner cannot approve",
    fn: async () => {
      const deps = approveDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callApprove(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Forbidden", `expected Forbidden, got ${body.error}`)
    },
  },
  {
    name: "POST approve: org admin short-circuit works",
    fn: async () => {
      const deps = approveDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callApprove(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST approve: cross-org returns 404",
    fn: async () => {
      const deps = approveDeps({
        getRequest: async () => ({ ...mockRequest, org_id: OTHER_ORG }),
        getRequestOrgId: async () => OTHER_ORG,
      })
      const res = await callApprove(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST approve: project not in org returns 404",
    fn: async () => {
      const deps = approveDeps({
        getProjectByKey: async () => null,
      })
      const res = await callApprove(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST approve: in-org insufficient permission returns 403",
    fn: async () => {
      const deps = approveDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callApprove(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "POST approve: unauthenticated returns 401",
    fn: async () => {
      const deps = approveDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callApprove(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "POST approve: request not found returns 404",
    fn: async () => {
      const deps = approveDeps({
        getRequest: async () => null,
      })
      const res = await callApprove(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  // --- Destroy route tests ---
  {
    name: "POST destroy: admin can destroy",
    fn: async () => {
      const deps = destroyDeps()
      const res = await callDestroy(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST destroy: deployer cannot destroy",
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
      const deps = destroyDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callDestroy(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST destroy: cross-org returns 404",
    fn: async () => {
      const deps = destroyDeps({
        getRequest: async () => ({ ...mockRequestForDestroy, org_id: OTHER_ORG }),
        getRequestOrgId: async () => OTHER_ORG,
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
  // --- Apply route tests (merge path) ---
  {
    name: "POST apply: operator can apply",
    fn: async () => {
      const deps = applyDeps()
      const res = await callApply(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST apply: planner cannot apply",
    fn: async () => {
      const deps = applyDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callApply(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Apply not permitted for your role", `expected apply error, got ${body.error}`)
    },
  },
  {
    name: "POST apply: org admin short-circuit works",
    fn: async () => {
      const deps = applyDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callApply(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST apply: cross-org returns 404",
    fn: async () => {
      const deps = applyDeps({
        getRequest: async () => ({ ...mockRequest, org_id: OTHER_ORG }),
        getRequestOrgId: async () => OTHER_ORG,
      })
      const res = await callApply(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST apply: project not in org returns 404",
    fn: async () => {
      const deps = applyDeps({
        getProjectByKey: async () => null,
      })
      const res = await callApply(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST apply: in-org insufficient permission returns 403",
    fn: async () => {
      const deps = applyDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callApply(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  // --- POST create/plan route tests ---
  {
    name: "POST create/plan: planner can create/plan → success",
    fn: async () => {
      const deps = requestsPOSTDeps()
      const res = await callCreatePlan(deps)
      assert(res.status === 200 || res.status === 201, `expected 200/201, got ${res.status}`)
      const body = await res.json()
      assert(body.success === true, `expected success, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST create/plan: viewer cannot create/plan → 403",
    fn: async () => {
      const deps = requestsPOSTDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Forbidden", `expected Forbidden, got ${body.error}`)
    },
  },
  {
    name: "POST create/plan: org admin short-circuit works → success",
    fn: async () => {
      const deps = requestsPOSTDeps({
        buildPermissionContext: async () => mockPermissionContext({ orgRole: "admin" }),
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 200 || res.status === 201, `expected 200/201, got ${res.status}`)
    },
  },
  {
    name: "POST create/plan: cross-org project lookup returns 404",
    fn: async () => {
      const deps = requestsPOSTDeps({
        resolveRequestEnvironment: async () => ({
          ok: true,
          resolved: { ...resolvedEnvForCreate, project_key: "otherproj" },
        }),
        getProjectByKey: async (orgId) =>
          orgId === ORG_ID ? null : { id: "proj_other", orgId: OTHER_ORG },
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not found", `expected Not found, got ${body.error}`)
    },
  },
  {
    name: "POST create/plan: project not in org returns 404",
    fn: async () => {
      const deps = requestsPOSTDeps({
        getProjectByKey: async () => null,
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 404, `expected 404, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not found", `expected Not found, got ${body.error}`)
    },
  },
  {
    name: "POST create/plan: in-org insufficient permission returns 403",
    fn: async () => {
      const deps = requestsPOSTDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Forbidden", `expected Forbidden, got ${body.error}`)
    },
  },
  {
    name: "POST create/plan: unauthenticated returns 401",
    fn: async () => {
      const deps = requestsPOSTDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callCreatePlan(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not authenticated", `expected Not authenticated, got ${body.error}`)
    },
  },
]
