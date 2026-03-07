/**
 * Unit tests: project roles RBAC engine.
 * Role ordering, maxProjectRole, org admin short-circuit, resolver, cache, permission helpers.
 */

import {
  compareProjectRoles,
  maxProjectRole,
  PROJECT_ROLE_ORDER,
  PROJECT_ROLE_RANK,
  resolveEffectiveProjectRole,
  userCanPlan,
  userCanApprove,
  userCanApply,
  userCanDestroy,
  userCanDeployEnv,
  userCanManageProjectAccess,
  type PermissionContext,
} from "@/lib/auth/projectRoles"
import type { ProjectRoleDb } from "@/lib/db/projectRoles"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "projectRoles: PROJECT_ROLE_ORDER has correct length and order",
    fn: () => {
      assert(PROJECT_ROLE_ORDER.length === 5, "5 roles")
      assert(PROJECT_ROLE_ORDER[0] === "viewer", "viewer first")
      assert(PROJECT_ROLE_ORDER[4] === "admin", "admin last")
    },
  },
  {
    name: "projectRoles: compareProjectRoles returns correct ordering",
    fn: () => {
      assert(compareProjectRoles("viewer", "admin") < 0, "viewer < admin")
      assert(compareProjectRoles("admin", "viewer") > 0, "admin > viewer")
      assert(compareProjectRoles("planner", "planner") === 0, "planner == planner")
      assert(compareProjectRoles(null, "viewer") < 0, "null < viewer")
      assert(compareProjectRoles("admin", null) > 0, "admin > null")
      assert(compareProjectRoles(null, null) === 0, "null == null")
    },
  },
  {
    name: "projectRoles: maxProjectRole returns highest role",
    fn: () => {
      assert(maxProjectRole(["viewer", "admin"]) === "admin", "admin wins")
      assert(maxProjectRole(["deployer", "planner", "operator"]) === "deployer", "deployer wins")
      assert(maxProjectRole(["viewer"]) === "viewer", "single viewer")
      assert(maxProjectRole([]) === null, "empty array")
      assert(maxProjectRole([null, null]) === null, "all null")
    },
  },
  {
    name: "projectRoles: org admin short-circuit returns admin without fetch",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "alice",
        orgId: "org1",
        orgRole: "admin",
        teamIds: [],
        projectRoleCache: new Map(),
      }
      let fetchCalls = 0
      const role = await resolveEffectiveProjectRole(ctx, "proj_1", async () => {
        fetchCalls++
        return []
      })
      assert(role === "admin", "org admin gets admin")
      assert(fetchCalls === 0, "fetch not called")
    },
  },
  {
    name: "projectRoles: direct user role resolution",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: [],
        projectRoleCache: new Map(),
      }
      const role = await resolveEffectiveProjectRole(ctx, "proj_1", async (pid, login) => {
        assert(pid === "proj_1", "project id passed")
        assert(login === "bob", "login passed")
        return ["operator"] as ProjectRoleDb[]
      })
      assert(role === "operator", "direct operator role")
    },
  },
  {
    name: "projectRoles: team role resolution",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: ["team_1"],
        projectRoleCache: new Map(),
      }
      const role = await resolveEffectiveProjectRole(ctx, "proj_1", async (pid, _, teamIds) => {
        assert(teamIds.length === 1 && teamIds[0] === "team_1", "team ids passed")
        return ["deployer"] as ProjectRoleDb[]
      })
      assert(role === "deployer", "team deployer role")
    },
  },
  {
    name: "projectRoles: highest of user and team wins",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: ["team_1"],
        projectRoleCache: new Map(),
      }
      const role = await resolveEffectiveProjectRole(ctx, "proj_1", async () =>
        ["planner", "deployer"] as ProjectRoleDb[]
      )
      assert(role === "deployer", "deployer wins over planner")
    },
  },
  {
    name: "projectRoles: no roles returns null",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: [],
        projectRoleCache: new Map(),
      }
      const role = await resolveEffectiveProjectRole(ctx, "proj_1", async () => [])
      assert(role === null, "no roles yields null")
    },
  },
  {
    name: "projectRoles: cache hit avoids duplicate lookup",
    fn: async () => {
      const ctx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: [],
        projectRoleCache: new Map(),
      }
      let fetchCalls = 0
      const fetchFn = async (): Promise<ProjectRoleDb[]> => {
        fetchCalls++
        return ["operator"] as ProjectRoleDb[]
      }
      const r1 = await resolveEffectiveProjectRole(ctx, "proj_1", fetchFn)
      const r2 = await resolveEffectiveProjectRole(ctx, "proj_1", fetchFn)
      assert(r1 === "operator" && r2 === "operator", "both return operator")
      assert(fetchCalls === 1, "fetch called once")
    },
  },
  {
    name: "projectRoles: permission helper matrix - viewer",
    fn: () => {
      assert(!userCanPlan("viewer"), "viewer cannot plan")
      assert(!userCanApprove("viewer"), "viewer cannot approve")
      assert(!userCanApply("viewer"), "viewer cannot apply")
      assert(!userCanDestroy("viewer"), "viewer cannot destroy")
      assert(!userCanDeployEnv("viewer"), "viewer cannot deploy env")
      assert(!userCanManageProjectAccess("viewer"), "viewer cannot manage access")
    },
  },
  {
    name: "projectRoles: permission helper matrix - planner",
    fn: () => {
      assert(userCanPlan("planner"), "planner can plan")
      assert(!userCanApprove("planner"), "planner cannot approve")
      assert(!userCanApply("planner"), "planner cannot apply")
      assert(!userCanDestroy("planner"), "planner cannot destroy")
      assert(!userCanDeployEnv("planner"), "planner cannot deploy env")
      assert(!userCanManageProjectAccess("planner"), "planner cannot manage access")
    },
  },
  {
    name: "projectRoles: permission helper matrix - operator",
    fn: () => {
      assert(userCanPlan("operator"), "operator can plan")
      assert(userCanApprove("operator"), "operator can approve")
      assert(userCanApply("operator"), "operator can apply")
      assert(!userCanDestroy("operator"), "operator cannot destroy")
      assert(!userCanDeployEnv("operator"), "operator cannot deploy env")
      assert(!userCanManageProjectAccess("operator"), "operator cannot manage access")
    },
  },
  {
    name: "projectRoles: permission helper matrix - deployer",
    fn: () => {
      assert(userCanPlan("deployer"), "deployer can plan")
      assert(userCanApprove("deployer"), "deployer can approve")
      assert(userCanApply("deployer"), "deployer can apply")
      assert(!userCanDestroy("deployer"), "deployer cannot destroy")
      assert(userCanDeployEnv("deployer"), "deployer can deploy env")
      assert(!userCanManageProjectAccess("deployer"), "deployer cannot manage access")
    },
  },
  {
    name: "projectRoles: permission helper matrix - admin",
    fn: () => {
      assert(userCanPlan("admin"), "admin can plan")
      assert(userCanApprove("admin"), "admin can approve")
      assert(userCanApply("admin"), "admin can apply")
      assert(userCanDestroy("admin"), "admin can destroy")
      assert(userCanDeployEnv("admin"), "admin can deploy env")
      assert(userCanManageProjectAccess("admin"), "admin can manage access")
    },
  },
  {
    name: "projectRoles: permission helpers return false for null",
    fn: () => {
      assert(!userCanPlan(null), "null cannot plan")
      assert(!userCanApprove(null), "null cannot approve")
      assert(!userCanApply(null), "null cannot apply")
      assert(!userCanDestroy(null), "null cannot destroy")
      assert(!userCanDeployEnv(null), "null cannot deploy env")
      assert(!userCanManageProjectAccess(null), "null cannot manage access")
    },
  },
]
