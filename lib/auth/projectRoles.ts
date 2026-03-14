/**
 * RBAC permission engine for project roles.
 * Resolver + permission helpers only; no route changes.
 * Reference: docs/plans-and-deltas/RBAC_OVERHAUL_ARCHITECTURE_DELTA.md
 */

import type { OrgRole } from "./orgRoles"
import { getUserOrgRole } from "./orgRoles"
import { getTeamIdsForUserInOrg } from "@/lib/db/teams"
import {
  fetchProjectRolesForUser,
  type ProjectRoleDb,
} from "@/lib/db/projectRoles"

export type ProjectRole = ProjectRoleDb

export const PROJECT_ROLE_ORDER: ProjectRole[] = [
  "viewer",
  "planner",
  "operator",
  "deployer",
  "admin",
]

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  planner: 1,
  operator: 2,
  deployer: 3,
  admin: 4,
}

/**
 * Compare two project roles. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareProjectRoles(
  a: ProjectRole | null,
  b: ProjectRole | null
): number {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  const ra = PROJECT_ROLE_RANK[a]
  const rb = PROJECT_ROLE_RANK[b]
  if (ra < rb) return -1
  if (ra > rb) return 1
  return 0
}

/**
 * Return the highest role from an array, or null if empty/invalid.
 */
export function maxProjectRole(roles: (ProjectRole | null)[]): ProjectRole | null {
  let max: ProjectRole | null = null
  for (const r of roles) {
    if (r === null) continue
    if (max === null || compareProjectRoles(r, max) > 0) max = r
  }
  return max
}

export type PermissionContext = {
  login: string
  orgId: string
  orgRole: OrgRole | null
  teamIds: string[]
  projectRoleCache: Map<string, ProjectRole | null>
}

export type FetchProjectRolesFn = (
  projectId: string,
  userLogin: string,
  teamIds: string[]
) => Promise<ProjectRoleDb[]>

/**
 * Build permission context for a user in an org.
 * Loads orgRole and teamIds once; creates empty projectRoleCache.
 */
export async function buildPermissionContext(
  login: string,
  orgId: string
): Promise<PermissionContext> {
  const [orgRole, teamIds] = await Promise.all([
    getUserOrgRole(login, orgId),
    getTeamIdsForUserInOrg(orgId, login),
  ])
  return {
    login: login.trim().toLowerCase(),
    orgId: orgId.trim(),
    orgRole,
    teamIds,
    projectRoleCache: new Map(),
  }
}

/**
 * Resolve effective project role for a user in a project.
 * Uses cache, org admin short-circuit, and single UNION query.
 * @param fetchFn - Optional; for tests. Defaults to fetchProjectRolesForUser.
 */
export async function resolveEffectiveProjectRole(
  ctx: PermissionContext,
  projectId: string,
  fetchFn: FetchProjectRolesFn = fetchProjectRolesForUser
): Promise<ProjectRole | null> {
  const cached = ctx.projectRoleCache.get(projectId)
  if (cached !== undefined) return cached

  if (ctx.orgRole === "admin") {
    ctx.projectRoleCache.set(projectId, "admin")
    return "admin"
  }

  const roles = await fetchFn(projectId, ctx.login, ctx.teamIds)
  const effective = maxProjectRole(roles)
  ctx.projectRoleCache.set(projectId, effective)
  return effective
}

// --- Permission helpers (pure; take role or null) ---

export function userCanPlan(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.planner
}

export function userCanApprove(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.operator
}

export function userCanApply(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.operator
}

export function userCanDestroy(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.admin
}

export function userCanDeploy(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.deployer
}

/** @deprecated Use userCanDeploy. */
export const userCanDeployEnv = userCanDeploy

export function userCanManageProjectAccess(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.admin
}
