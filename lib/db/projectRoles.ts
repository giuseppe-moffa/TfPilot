/**
 * Data access for project_user_roles and project_team_roles tables.
 * RBAC foundation for env0-style project role resolution.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type ProjectRoleDb = "viewer" | "planner" | "operator" | "deployer" | "admin"

const ROLES_LIST: ProjectRoleDb[] = [
  "viewer",
  "planner",
  "operator",
  "deployer",
  "admin",
]

export const VALID_PROJECT_ROLES: readonly ProjectRoleDb[] = ROLES_LIST

export function isValidProjectRole(r: unknown): r is ProjectRoleDb {
  return typeof r === "string" && ROLES_LIST.includes(r as ProjectRoleDb)
}

/**
 * Fetch all project roles for a user (direct + via teams) in a single query.
 * Returns empty array when DB not configured.
 */
export async function fetchProjectRolesForUser(
  projectId: string,
  userLogin: string,
  teamIds: string[]
): Promise<ProjectRoleDb[]> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !userLogin?.trim()) return []

  const normalizedLogin = userLogin.trim().toLowerCase()

  const result = await query<{ role: string }>(
    `SELECT role::text AS role FROM project_user_roles
     WHERE project_id = $1 AND user_login = $2
     UNION
     SELECT role::text AS role FROM project_team_roles
     WHERE project_id = $1 AND team_id = ANY($3)`,
    [projectId.trim(), normalizedLogin, teamIds]
  )

  if (!result) return []

  return result.rows
    .map((r) => r.role)
    .filter((r): r is ProjectRoleDb => isValidProjectRole(r))
}

// --- project_team_roles CRUD ---

export type ProjectTeamRoleGrant = { teamId: string; projectId: string; role: ProjectRoleDb }

export async function listProjectTeamRolesByOrg(
  orgId: string
): Promise<ProjectTeamRoleGrant[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<ProjectTeamRoleGrant>(
    `SELECT ptr.team_id AS "teamId", ptr.project_id AS "projectId", ptr.role::text AS role
     FROM project_team_roles ptr
     JOIN teams t ON t.id = ptr.team_id AND t.org_id = $1
     JOIN projects p ON p.id = ptr.project_id AND p.org_id = $1`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows.filter((r) => isValidProjectRole(r.role))
}

export async function upsertProjectTeamRole(
  projectId: string,
  teamId: string,
  role: ProjectRoleDb
): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !teamId?.trim()) return false
  const result = await query(
    `INSERT INTO project_team_roles (project_id, team_id, role, created_at)
     VALUES ($1, $2, $3::project_role, NOW())
     ON CONFLICT (project_id, team_id) DO UPDATE SET role = $3::project_role`,
    [projectId.trim(), teamId.trim(), role]
  )
  return result != null
}

export async function deleteProjectTeamRole(
  projectId: string,
  teamId: string
): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !teamId?.trim()) return false
  const result = await query(
    "DELETE FROM project_team_roles WHERE project_id = $1 AND team_id = $2",
    [projectId.trim(), teamId.trim()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}

// --- project_user_roles CRUD ---

export type ProjectUserRoleGrant = { userLogin: string; projectId: string; role: ProjectRoleDb }

export async function listProjectUserRolesByProject(
  projectId: string
): Promise<ProjectUserRoleGrant[]> {
  if (!isDatabaseConfigured() || !projectId?.trim()) return []
  const result = await query<ProjectUserRoleGrant>(
    `SELECT user_login AS "userLogin", project_id AS "projectId", role::text AS role
     FROM project_user_roles WHERE project_id = $1`,
    [projectId.trim()]
  )
  if (!result) return []
  return result.rows.filter((r) => isValidProjectRole(r.role))
}

export async function listProjectTeamRolesByProject(
  projectId: string
): Promise<{ teamId: string; role: ProjectRoleDb }[]> {
  if (!isDatabaseConfigured() || !projectId?.trim()) return []
  const result = await query<{ teamId: string; role: string }>(
    `SELECT team_id AS "teamId", role::text AS role
     FROM project_team_roles WHERE project_id = $1`,
    [projectId.trim()]
  )
  if (!result) return []
  return result.rows.filter((r) => isValidProjectRole(r.role)).map((r) => ({ ...r, role: r.role as ProjectRoleDb }))
}

export async function upsertProjectUserRole(
  projectId: string,
  userLogin: string,
  role: ProjectRoleDb
): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !userLogin?.trim()) return false
  const normalizedLogin = userLogin.trim().toLowerCase()
  const result = await query(
    `INSERT INTO project_user_roles (project_id, user_login, role, created_at)
     VALUES ($1, $2, $3::project_role, NOW())
     ON CONFLICT (project_id, user_login) DO UPDATE SET role = $3::project_role`,
    [projectId.trim(), normalizedLogin, role]
  )
  return result != null
}

export async function deleteProjectUserRole(
  projectId: string,
  userLogin: string
): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !userLogin?.trim()) return false
  const result = await query(
    "DELETE FROM project_user_roles WHERE project_id = $1 AND user_login = $2",
    [projectId.trim(), userLogin.trim().toLowerCase()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}
