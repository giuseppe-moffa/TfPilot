/**
 * Permission wrapper layer for Phase 2 RBAC refactor.
 * Safe helpers for routes to adopt; does not remove legacy RBAC.
 * Reference: docs/plans-and-deltas/RBAC_OVERHAUL_ARCHITECTURE_DELTA.md
 */

import {
  buildPermissionContext as buildPermissionContextImpl,
  resolveEffectiveProjectRole,
  PROJECT_ROLE_RANK,
  userCanPlan,
  userCanApprove,
  userCanApply,
  userCanDestroy,
  userCanDeploy,
  userCanManageProjectAccess,
  type PermissionContext,
  type ProjectRole,
} from "./projectRoles"

/** Re-export for routes that need both buildPermissionContext and requireProjectPermission. */
export { buildPermissionContext, type PermissionContext } from "./projectRoles"

/** Error thrown on permission denial. status=403, no role leakage. */
export class PermissionDeniedError extends Error {
  readonly status = 403

  constructor() {
    super("Forbidden")
    this.name = "PermissionDeniedError"
  }
}

export type ProjectPermission =
  | "plan"
  | "approve"
  | "apply"
  | "destroy"
  | "deploy"
  | "manage_access"

export type PermissionsDeps = {
  buildContext?: (login: string, orgId: string) => Promise<PermissionContext>
}

/**
 * Resolve effective project role for a user.
 * Builds context, resolves role; no caching outside the context.
 */
export async function getEffectiveProjectRole(
  login: string,
  orgId: string,
  projectId: string,
  deps?: PermissionsDeps
): Promise<ProjectRole | null> {
  const ctx = deps?.buildContext
    ? await deps.buildContext(login, orgId)
    : await buildPermissionContextImpl(login, orgId)
  return resolveEffectiveProjectRole(ctx, projectId)
}

/**
 * Require minimum project role. Throws PermissionDeniedError if role rank < minRole.
 */
export async function requireProjectRole(
  ctx: PermissionContext,
  projectId: string,
  minRole: ProjectRole
): Promise<ProjectRole> {
  const role = await resolveEffectiveProjectRole(ctx, projectId)
  if (role === null) throw new PermissionDeniedError()
  if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK[minRole]) {
    throw new PermissionDeniedError()
  }
  return role
}

const PERMISSION_CHECKERS: Record<
  ProjectPermission,
  (role: ProjectRole | null) => boolean
> = {
  plan: userCanPlan,
  approve: userCanApprove,
  apply: userCanApply,
  destroy: userCanDestroy,
  deploy: userCanDeploy,
  manage_access: userCanManageProjectAccess,
}

/**
 * Require specific permission. Throws PermissionDeniedError if not allowed.
 */
export async function requireProjectPermission(
  ctx: PermissionContext,
  projectId: string,
  permission: ProjectPermission
): Promise<ProjectRole | null> {
  const role = await resolveEffectiveProjectRole(ctx, projectId)
  const check = PERMISSION_CHECKERS[permission]
  if (!check(role)) throw new PermissionDeniedError()
  return role
}
