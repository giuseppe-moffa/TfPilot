/**
 * Unit tests: project access (userHasProjectAccess, userHasProjectKeyAccess).
 * Uses createProjectAccess with mocked deps; no real DB.
 */

import { createProjectAccess, type ProjectAccessDeps } from "@/lib/auth/projectAccess"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function defaultDeps(overrides: Partial<ProjectAccessDeps> = {}): ProjectAccessDeps {
  return {
    getUserOrgRole: async () => null,
    getProjectByKey: async () => null,
    query: async () => ({ rows: [], rowCount: 0 }),
    ...overrides,
  }
}

export const tests = [
  {
    name: "projectAccess: org admin short-circuit grants access without team mapping",
    fn: async () => {
      const { userHasProjectAccess, userHasProjectKeyAccess } = createProjectAccess(
        defaultDeps({ getUserOrgRole: async () => "admin" })
      )
      const byId = await userHasProjectAccess("alice", "org1", "proj_1")
      const byKey = await userHasProjectKeyAccess("alice", "org1", "core")
      assert(byId === true, "org admin has access by project ID")
      assert(byKey === true, "org admin has access by project key")
    },
  },
  {
    name: "projectAccess: non-admin with team access granted",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "developer",
          query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
        })
      )
      const ok = await userHasProjectAccess("bob", "org1", "proj_1")
      assert(ok === true, "non-admin with team membership has access")
    },
  },
  {
    name: "projectAccess: non-admin with no access returns false",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "developer",
          query: async () => ({ rows: [], rowCount: 0 }),
        })
      )
      const ok = await userHasProjectAccess("bob", "org1", "proj_1")
      assert(ok === false, "non-admin without team access denied")
    },
  },
  {
    name: "projectAccess: non-admin path hits team/project query exactly once",
    fn: async () => {
      let queryCalls = 0
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "developer",
          query: async () => {
            queryCalls++
            return { rows: [{ ok: 1 }], rowCount: 1 }
          },
        })
      )
      const ok = await userHasProjectAccess("bob", "org1", "proj_1")
      assert(ok === true, "non-admin with team access granted")
      assert(queryCalls === 1, "team/project query invoked exactly once")
    },
  },
  {
    name: "projectAccess: multiple teams — access if any team has project",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "viewer",
          query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
        })
      )
      const ok = await userHasProjectAccess("carol", "org1", "proj_2")
      assert(ok === true, "user in multiple teams gets access when one has project")
    },
  },
  {
    name: "projectAccess: wrong org isolation — other org membership does not grant access",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async (login, orgId) => (orgId === "org_other" ? "admin" : null),
          query: async () => ({ rows: [], rowCount: 0 }),
        })
      )
      const ok = await userHasProjectAccess("alice", "org_target", "proj_1")
      assert(ok === false, "admin in other org has no access in target org")
    },
  },
  {
    name: "projectAccess: missing project (getProjectByKey null) returns false",
    fn: async () => {
      const { userHasProjectKeyAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "developer",
          getProjectByKey: async () => null,
        })
      )
      const ok = await userHasProjectKeyAccess("bob", "org1", "nonexistent")
      assert(ok === false, "missing project returns false")
    },
  },
  {
    name: "projectAccess: missing login returns false",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(defaultDeps())
      const ok = await userHasProjectAccess(null, "org1", "proj_1")
      assert(ok === false, "null login returns false")
    },
  },
  {
    name: "projectAccess: empty orgId returns false",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(defaultDeps())
      const ok = await userHasProjectAccess("alice", "", "proj_1")
      assert(ok === false, "empty orgId returns false")
    },
  },
  {
    name: "projectAccess: empty projectId returns false",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(defaultDeps())
      const ok = await userHasProjectAccess("alice", "org1", "")
      assert(ok === false, "empty projectId returns false")
    },
  },
  {
    name: "projectAccess: determinism — same inputs produce same result",
    fn: async () => {
      let callCount = 0
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "admin",
          query: async () => {
            callCount++
            return { rows: [], rowCount: 0 }
          },
        })
      )
      const r1 = await userHasProjectAccess("alice", "org1", "proj_1")
      const r2 = await userHasProjectAccess("alice", "org1", "proj_1")
      assert(r1 === true && r2 === true, "same result for same inputs")
      assert(callCount === 0, "org admin short-circuit skips query")
    },
  },
  {
    name: "projectAccess: userHasProjectKeyAccess resolves project then checks access",
    fn: async () => {
      const { userHasProjectKeyAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async () => "developer",
          getProjectByKey: async (orgId, key) =>
            key === "core" ? { id: "proj_1", orgId, projectKey: key, name: "Core" } : null,
          query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
        })
      )
      const ok = await userHasProjectKeyAccess("bob", "org1", "core")
      assert(ok === true, "project key resolved to id, then team access checked")
    },
  },
  {
    name: "projectAccess: login normalized to lowercase",
    fn: async () => {
      const { userHasProjectAccess } = createProjectAccess(
        defaultDeps({
          getUserOrgRole: async (login) => (login === "alice" ? "admin" : null),
        })
      )
      const ok = await userHasProjectAccess("  ALICE  ", "org1", "proj_1")
      assert(ok === true, "login trimmed and lowercased before role lookup")
    },
  },
]
