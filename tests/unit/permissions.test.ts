/**
 * Unit tests: permission wrapper layer (requireProjectRole, requireProjectPermission, getEffectiveProjectRole).
 * Uses pre-populated projectRoleCache to mock resolver; no DB.
 */

import {
  requireProjectRole,
  requireProjectPermission,
  getEffectiveProjectRole,
  PermissionDeniedError,
  type ProjectPermission,
} from "@/lib/auth/permissions"
import type { PermissionContext } from "@/lib/auth/projectRoles"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function ctxWithCache(projectId: string, role: "viewer" | "planner" | "operator" | "deployer" | "admin" | null): PermissionContext {
  const cache = new Map<string, "viewer" | "planner" | "operator" | "deployer" | "admin" | null>()
  cache.set(projectId, role)
  return {
    login: "alice",
    orgId: "org1",
    orgRole: "developer",
    teamIds: [],
    projectRoleCache: cache,
  }
}

export const tests = [
  {
    name: "permissions: requireProjectRole success — admin meets viewer min",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "admin")
      const role = await requireProjectRole(ctx, "proj_1", "viewer")
      assert(role === "admin", "returns admin")
    },
  },
  {
    name: "permissions: requireProjectRole success — operator meets operator min",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "operator")
      const role = await requireProjectRole(ctx, "proj_1", "operator")
      assert(role === "operator", "returns operator")
    },
  },
  {
    name: "permissions: requireProjectRole failure — viewer below operator min",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "viewer")
      try {
        await requireProjectRole(ctx, "proj_1", "operator")
        assert(false, "should have thrown")
      } catch (e) {
        assert(e instanceof PermissionDeniedError, "PermissionDeniedError")
        assert((e as PermissionDeniedError).status === 403, "status 403")
        assert((e as Error).message === "Forbidden", "message Forbidden")
      }
    },
  },
  {
    name: "permissions: requireProjectRole failure — null role",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", null)
      try {
        await requireProjectRole(ctx, "proj_1", "viewer")
        assert(false, "should have thrown")
      } catch (e) {
        assert(e instanceof PermissionDeniedError, "PermissionDeniedError")
      }
    },
  },
  {
    name: "permissions: requireProjectPermission plan — planner allowed",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "planner")
      const role = await requireProjectPermission(ctx, "proj_1", "plan")
      assert(role === "planner", "returns planner")
    },
  },
  {
    name: "permissions: requireProjectPermission plan — viewer denied",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "viewer")
      try {
        await requireProjectPermission(ctx, "proj_1", "plan")
        assert(false, "should have thrown")
      } catch (e) {
        assert(e instanceof PermissionDeniedError, "PermissionDeniedError")
      }
    },
  },
  {
    name: "permissions: requireProjectPermission apply — operator allowed",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "operator")
      const role = await requireProjectPermission(ctx, "proj_1", "apply")
      assert(role === "operator", "returns operator")
    },
  },
  {
    name: "permissions: requireProjectPermission destroy — admin allowed",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "admin")
      const role = await requireProjectPermission(ctx, "proj_1", "destroy")
      assert(role === "admin", "returns admin")
    },
  },
  {
    name: "permissions: requireProjectPermission destroy — operator denied",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "operator")
      try {
        await requireProjectPermission(ctx, "proj_1", "destroy")
        assert(false, "should have thrown")
      } catch (e) {
        assert(e instanceof PermissionDeniedError, "PermissionDeniedError")
      }
    },
  },
  {
    name: "permissions: requireProjectPermission deploy — deployer allowed",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", "deployer")
      const role = await requireProjectPermission(ctx, "proj_1", "deploy")
      assert(role === "deployer", "returns deployer")
    },
  },
  {
    name: "permissions: null role behavior — plan denied",
    fn: async () => {
      const ctx = ctxWithCache("proj_1", null)
      try {
        await requireProjectPermission(ctx, "proj_1", "plan")
        assert(false, "should have thrown")
      } catch (e) {
        assert(e instanceof PermissionDeniedError, "PermissionDeniedError")
      }
    },
  },
  {
    name: "permissions: org admin short-circuit — cache admin, require deployer",
    fn: async () => {
      const cache = new Map<string, "viewer" | "planner" | "operator" | "deployer" | "admin" | null>()
      cache.set("proj_1", "admin")
      const ctx: PermissionContext = {
        login: "alice",
        orgId: "org1",
        orgRole: "admin",
        teamIds: [],
        projectRoleCache: cache,
      }
      const role = await requireProjectRole(ctx, "proj_1", "deployer")
      assert(role === "admin", "org admin gets admin from cache")
    },
  },
  {
    name: "permissions: getEffectiveProjectRole with mock buildContext",
    fn: async () => {
      const cache = new Map<string, "viewer" | "planner" | "operator" | "deployer" | "admin" | null>()
      cache.set("proj_1", "operator")
      const mockCtx: PermissionContext = {
        login: "bob",
        orgId: "org1",
        orgRole: "developer",
        teamIds: [],
        projectRoleCache: cache,
      }
      const role = await getEffectiveProjectRole("bob", "org1", "proj_1", {
        buildContext: async () => mockCtx,
      })
      assert(role === "operator", "returns operator from mock context")
    },
  },
  {
    name: "permissions: PermissionDeniedError has status 403 and generic message",
    fn: () => {
      const err = new PermissionDeniedError()
      assert(err.status === 403, "status 403")
      assert(err.message === "Forbidden", "message Forbidden")
      assert(err.name === "PermissionDeniedError", "name")
    },
  },
]
