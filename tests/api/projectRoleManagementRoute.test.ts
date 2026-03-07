/**
 * API route tests: project role management routes.
 * Uses factory/DI pattern with injected mocks; no real DB or auth.
 *
 * Routes under test:
 * - GET/POST/DELETE /api/org/teams/access
 * - GET /api/org/projects/[projectId]/roles
 * - POST /api/org/projects/[projectId]/users
 * - DELETE /api/org/projects/[projectId]/users/[login]
 */

import { NextRequest, NextResponse } from "next/server"
import { PermissionDeniedError } from "@/lib/auth/permissions"
import { isValidProjectRole, type ProjectRoleDb } from "@/lib/db/projectRoles"
import {
  makeTeamsAccessGET,
  makeTeamsAccessPOST,
  makeTeamsAccessDELETE,
  type TeamsAccessDeps,
} from "@/app/api/org/teams/access/route"
import {
  makeProjectRolesGET,
  type ProjectRolesRouteDeps,
} from "@/app/api/org/projects/[projectId]/roles/route"
import {
  makeProjectUsersPOST,
  type ProjectUsersRouteDeps,
} from "@/app/api/org/projects/[projectId]/users/route"
import {
  makeProjectUserDELETE,
  type ProjectUserDeleteRouteDeps,
} from "@/app/api/org/projects/[projectId]/users/[login]/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const ORG_ID = "org_1"
const PROJECT_ID = "proj_1"
const TEAM_ID = "team_1"
const OTHER_ORG = "org_other"

const mockSession = {
  login: "alice",
  name: "Alice",
  avatarUrl: null,
  orgId: ORG_ID,
}

// --- Teams access deps ---

function teamsAccessDeps(overrides: Partial<TeamsAccessDeps> = {}): TeamsAccessDeps {
  const projectRoleCache = new Map<string, ProjectRoleDb | null>()
  const mockCtx = {
    login: mockSession.login,
    orgId: mockSession.orgId,
    orgRole: null as "viewer" | "developer" | "approver" | "admin" | null,
    teamIds: [] as string[],
    projectRoleCache,
  }
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    buildPermissionContext: async () => mockCtx,
    requireProjectPermission: async () => null,
    getTeamById: async (id) =>
      id === TEAM_ID ? { orgId: ORG_ID, slug: "eng" } : id === "team_other" ? { orgId: OTHER_ORG, slug: "other" } : null,
    getProjectById: async (id) =>
      id === PROJECT_ID ? { orgId: ORG_ID, projectKey: "myproj" } : id === "proj_other" ? { orgId: OTHER_ORG, projectKey: "other" } : null,
    listProjectTeamRolesByOrg: async () => [
      { teamId: TEAM_ID, projectId: PROJECT_ID, role: "operator" },
    ],
    upsertProjectTeamRole: async () => true,
    deleteProjectTeamRole: async () => true,
    isValidProjectRole,
    writeAuditEvent: async () => {},
    ...overrides,
  }
}

// --- Project roles deps ---

function projectRolesDeps(overrides: Partial<ProjectRolesRouteDeps> = {}): ProjectRolesRouteDeps {
  const projectRoleCache = new Map<string, ProjectRoleDb | null>()
  const mockCtx = {
    login: mockSession.login,
    orgId: mockSession.orgId,
    orgRole: null as "viewer" | "developer" | "approver" | "admin" | null,
    teamIds: [] as string[],
    projectRoleCache,
  }
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    buildPermissionContext: async () => mockCtx,
    requireProjectPermission: async () => null,
    getProjectById: async (id) => (id === PROJECT_ID ? { orgId: ORG_ID } : null),
    listProjectUserRolesByProject: async () => [
      { userLogin: "bob", projectId: PROJECT_ID, role: "deployer" },
    ],
    listProjectTeamRolesByProject: async () => [
      { teamId: TEAM_ID, role: "operator" },
    ],
    ...overrides,
  }
}

// --- Project users deps ---

function projectUsersDeps(overrides: Partial<ProjectUsersRouteDeps> = {}): ProjectUsersRouteDeps {
  const projectRoleCache = new Map<string, ProjectRoleDb | null>()
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    buildPermissionContext: async (_login: string, _orgId: string) => ({
      login: mockSession.login,
      orgId: mockSession.orgId,
      orgRole: null,
      teamIds: [],
      projectRoleCache,
    }),
    requireProjectPermission: async () => null,
    getProjectById: async (id) =>
      id === PROJECT_ID ? { orgId: ORG_ID, projectKey: "myproj" } : null,
    upsertProjectUserRole: async () => true,
    isValidProjectRole,
    writeAuditEvent: async () => {},
    ...overrides,
  }
}

// --- Project user delete deps ---

function projectUserDeleteDeps(
  overrides: Partial<ProjectUserDeleteRouteDeps> = {}
): ProjectUserDeleteRouteDeps {
  const projectRoleCache = new Map<string, ProjectRoleDb | null>()
  const mockCtx = {
    login: mockSession.login,
    orgId: mockSession.orgId,
    orgRole: null as "viewer" | "developer" | "approver" | "admin" | null,
    teamIds: [] as string[],
    projectRoleCache,
  }
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    buildPermissionContext: async () => mockCtx,
    requireProjectPermission: async () => null,
    getProjectById: async (id) =>
      id === PROJECT_ID ? { orgId: ORG_ID, projectKey: "myproj" } : null,
    deleteProjectUserRole: async () => true,
    writeAuditEvent: async () => {},
    ...overrides,
  }
}

// --- Helpers ---

async function callTeamsAccessGET(deps: TeamsAccessDeps): Promise<Response> {
  const GET = makeTeamsAccessGET(deps)
  const res = await GET()
  return res as unknown as Response
}

async function callTeamsAccessPOST(
  deps: TeamsAccessDeps,
  body: object
): Promise<Response> {
  const POST = makeTeamsAccessPOST(deps)
  const req = new NextRequest("http://localhost/api/org/teams/access", {
    method: "POST",
    body: JSON.stringify(body),
  })
  const res = await POST(req)
  return res as unknown as Response
}

async function callTeamsAccessDELETE(
  deps: TeamsAccessDeps,
  body: object
): Promise<Response> {
  const DELETE = makeTeamsAccessDELETE(deps)
  const req = new NextRequest("http://localhost/api/org/teams/access", {
    method: "DELETE",
    body: JSON.stringify(body),
  })
  const res = await DELETE(req)
  return res as unknown as Response
}

async function callProjectRolesGET(
  deps: ProjectRolesRouteDeps,
  projectId: string
): Promise<Response> {
  const GET = makeProjectRolesGET(deps)
  const req = new NextRequest(`http://localhost/api/org/projects/${projectId}/roles`)
  const ctx = { params: Promise.resolve({ projectId }) }
  const res = await GET(req, ctx)
  return res as unknown as Response
}

async function callProjectUsersPOST(
  deps: ProjectUsersRouteDeps,
  projectId: string,
  body: object
): Promise<Response> {
  const POST = makeProjectUsersPOST(deps)
  const req = new NextRequest(`http://localhost/api/org/projects/${projectId}/users`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  const ctx = { params: Promise.resolve({ projectId }) }
  const res = await POST(req, ctx)
  return res as unknown as Response
}

async function callProjectUserDELETE(
  deps: ProjectUserDeleteRouteDeps,
  projectId: string,
  login: string
): Promise<Response> {
  const DELETE = makeProjectUserDELETE(deps)
  const req = new NextRequest(
    `http://localhost/api/org/projects/${projectId}/users/${login}`,
    { method: "DELETE" }
  )
  const ctx = { params: Promise.resolve({ projectId, login }) }
  const res = await DELETE(req, ctx)
  return res as unknown as Response
}

// --- Tests ---

export const tests = [
  // --- Org admin can assign direct user role ---
  {
    name: "POST projects/users: org admin can assign direct user role",
    fn: async () => {
      const deps = projectUsersDeps()
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        login: "bob",
        role: "deployer",
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
    },
  },

  // --- Org admin can assign team role ---
  {
    name: "POST teams/access: org admin can assign team role",
    fn: async () => {
      const deps = teamsAccessDeps()
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: "operator",
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
    },
  },

  // --- Project admin can assign/update/remove roles ---
  {
    name: "POST teams/access: project admin can assign team role",
    fn: async () => {
      const deps = teamsAccessDeps({
        requireProjectPermission: async () => null,
      })
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: "admin",
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "POST projects/users: project admin can assign user role",
    fn: async () => {
      const deps = projectUsersDeps({
        requireProjectPermission: async () => null,
      })
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        login: "charlie",
        role: "viewer",
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "DELETE projects/users/[login]: project admin can remove user role",
    fn: async () => {
      const deps = projectUserDeleteDeps({
        requireProjectPermission: async () => null,
      })
      const res = await callProjectUserDELETE(deps, PROJECT_ID, "bob")
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },
  {
    name: "DELETE teams/access: project admin can remove team role",
    fn: async () => {
      const deps = teamsAccessDeps({
        requireProjectPermission: async () => null,
      })
      const res = await callTeamsAccessDELETE(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
    },
  },

  // --- Deployer / operator / viewer denied ---
  {
    name: "POST projects/users: deployer denied",
    fn: async () => {
      const deps = projectUsersDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        login: "bob",
        role: "admin",
      })
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Forbidden", `expected Forbidden, got ${body.error}`)
    },
  },
  {
    name: "POST teams/access: operator denied",
    fn: async () => {
      const deps = teamsAccessDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: "operator",
      })
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "GET projects/roles: viewer denied",
    fn: async () => {
      const deps = projectRolesDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callProjectRolesGET(deps, PROJECT_ID)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "DELETE projects/users/[login]: deployer denied",
    fn: async () => {
      const deps = projectUserDeleteDeps({
        requireProjectPermission: async () => {
          throw new PermissionDeniedError()
        },
      })
      const res = await callProjectUserDELETE(deps, PROJECT_ID, "bob")
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },

  // --- Cross-org returns 404 ---
  {
    name: "POST teams/access: cross-org team returns 404",
    fn: async () => {
      const deps = teamsAccessDeps({
        getTeamById: async () => ({ orgId: OTHER_ORG, slug: "other" }),
        getProjectById: async () => ({ orgId: ORG_ID, projectKey: "myproj" }),
      })
      const res = await callTeamsAccessPOST(deps, {
        teamId: "team_other",
        projectId: PROJECT_ID,
        role: "operator",
      })
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST teams/access: cross-org project returns 404",
    fn: async () => {
      const deps = teamsAccessDeps({
        getTeamById: async () => ({ orgId: ORG_ID, slug: "eng" }),
        getProjectById: async () => ({ orgId: OTHER_ORG, projectKey: "other" }),
      })
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: "proj_other",
        role: "operator",
      })
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "GET projects/roles: cross-org project returns 404",
    fn: async () => {
      const deps = projectRolesDeps({
        getProjectById: async () => ({ orgId: OTHER_ORG }),
      })
      const res = await callProjectRolesGET(deps, "proj_other")
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },
  {
    name: "POST projects/users: cross-org project returns 404",
    fn: async () => {
      const deps = projectUsersDeps({
        getProjectById: async () => ({ orgId: OTHER_ORG, projectKey: "other" }),
      })
      const res = await callProjectUsersPOST(deps, "proj_other", {
        login: "bob",
        role: "admin",
      })
      assert(res.status === 404, `expected 404, got ${res.status}`)
    },
  },

  // --- Invalid role returns 400 ---
  {
    name: "POST teams/access: invalid role returns 400",
    fn: async () => {
      const deps = teamsAccessDeps()
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: "superadmin",
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(
        body.error?.includes("role must be one of"),
        `expected role error, got ${body.error}`
      )
    },
  },
  {
    name: "POST projects/users: invalid role returns 400",
    fn: async () => {
      const deps = projectUsersDeps()
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        login: "bob",
        role: "invalid",
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(
        body.error?.includes("role must be one of"),
        `expected role error, got ${body.error}`
      )
    },
  },
  {
    name: "POST projects/users: missing role returns 400",
    fn: async () => {
      const deps = projectUsersDeps()
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        login: "bob",
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
    },
  },

  // --- Delete works ---
  {
    name: "DELETE teams/access: delete works",
    fn: async () => {
      const deps = teamsAccessDeps()
      const res = await callTeamsAccessDELETE(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "DELETE projects/users/[login]: delete works",
    fn: async () => {
      const deps = projectUserDeleteDeps()
      const res = await callProjectUserDELETE(deps, PROJECT_ID, "bob")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
    },
  },

  // --- List returns direct + team assignments ---
  {
    name: "GET projects/roles: list returns direct + team assignments",
    fn: async () => {
      const deps = projectRolesDeps()
      const res = await callProjectRolesGET(deps, PROJECT_ID)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(Array.isArray(body.users), `expected users array, got ${typeof body.users}`)
      assert(Array.isArray(body.teams), `expected teams array, got ${typeof body.teams}`)
      assert(
        body.users.some((u: { login: string }) => u.login === "bob"),
        `expected bob in users, got ${JSON.stringify(body.users)}`
      )
      assert(
        body.teams.some((t: { teamId: string }) => t.teamId === TEAM_ID),
        `expected team in teams, got ${JSON.stringify(body.teams)}`
      )
    },
  },

  // --- GET teams/access returns grants ---
  {
    name: "GET teams/access: returns grants for projects with manage_access",
    fn: async () => {
      const deps = teamsAccessDeps()
      const res = await callTeamsAccessGET(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(Array.isArray(body.grants), `expected grants array, got ${typeof body.grants}`)
      assert(
        body.grants.some(
          (g: { teamId: string; projectId: string; role: string }) =>
            g.teamId === TEAM_ID && g.projectId === PROJECT_ID && g.role === "operator"
        ),
        `expected team grant, got ${JSON.stringify(body.grants)}`
      )
    },
  },

  // --- POST teams/access: role optional, defaults to operator ---
  {
    name: "POST teams/access: role optional defaults to operator",
    fn: async () => {
      let capturedRole: string | null = null
      const deps = teamsAccessDeps({
        upsertProjectTeamRole: async (_projectId, _teamId, role) => {
          capturedRole = role
          return true
        },
      })
      const res = await callTeamsAccessPOST(deps, {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      assert(capturedRole === "operator", `expected operator, got ${capturedRole}`)
    },
  },

  // --- Unauthenticated returns 401 ---
  {
    name: "GET teams/access: unauthenticated returns 401",
    fn: async () => {
      const deps = teamsAccessDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callTeamsAccessGET(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "GET projects/roles: unauthenticated returns 401",
    fn: async () => {
      const deps = projectRolesDeps({
        getSessionFromCookies: async () => null,
      })
      const res = await callProjectRolesGET(deps, PROJECT_ID)
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },

  // --- Missing required body fields ---
  {
    name: "POST teams/access: missing teamId returns 400",
    fn: async () => {
      const deps = teamsAccessDeps()
      const res = await callTeamsAccessPOST(deps, {
        projectId: PROJECT_ID,
        role: "operator",
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
    },
  },
  {
    name: "POST projects/users: missing login returns 400",
    fn: async () => {
      const deps = projectUsersDeps()
      const res = await callProjectUsersPOST(deps, PROJECT_ID, {
        role: "admin",
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
    },
  },
]
