/**
 * Data access for project_team_access table.
 * Team-based project access grants.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type ProjectTeamGrant = {
  teamId: string
  projectId: string
}

/**
 * List project-team access grants for an org. Only returns grants where both
 * team and project belong to the org (via join).
 */
export async function listProjectTeamAccessByOrg(orgId: string): Promise<ProjectTeamGrant[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<ProjectTeamGrant>(
    `SELECT pta.team_id AS "teamId", pta.project_id AS "projectId"
     FROM project_team_access pta
     JOIN teams t ON t.id = pta.team_id AND t.org_id = $1
     JOIN projects p ON p.id = pta.project_id AND p.org_id = $1`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

/**
 * Grant team access to project. ON CONFLICT DO NOTHING (idempotent).
 * Returns true if a row was inserted, false if already existed.
 */
export async function grantProjectTeamAccess(projectId: string, teamId: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !teamId?.trim()) return false
  const result = await query(
    `INSERT INTO project_team_access (project_id, team_id, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (project_id, team_id) DO NOTHING`,
    [projectId.trim(), teamId.trim()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}

/**
 * Revoke team access from project. Returns true if a row was deleted.
 */
export async function revokeProjectTeamAccess(projectId: string, teamId: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !projectId?.trim() || !teamId?.trim()) return false
  const result = await query(
    "DELETE FROM project_team_access WHERE project_id = $1 AND team_id = $2",
    [projectId.trim(), teamId.trim()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}
