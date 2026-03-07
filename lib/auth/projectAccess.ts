/**
 * Project access checks via org admin or team membership.
 * Resolves through: org admin short-circuit, team_memberships, project_team_access, projects.
 */

import { getUserOrgRole } from "@/lib/auth/orgRoles"
import { getProjectByKey } from "@/lib/db/projects"
import { query } from "@/lib/db/pg"

function normalizeLogin(login?: string | null): string {
  return (login ?? "").trim().toLowerCase()
}

/**
 * Check if user has access to a project by ID.
 * Org admin: always allowed. Else: member of at least one team with project access.
 */
export async function userHasProjectAccess(
  login: string | undefined | null,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const n = normalizeLogin(login)
  if (!n || !orgId?.trim() || !projectId?.trim()) return false

  const role = await getUserOrgRole(n, orgId.trim())
  if (role === "admin") return true

  const result = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM projects p
     JOIN project_team_access pta ON pta.project_id = p.id
     JOIN team_memberships tm ON tm.team_id = pta.team_id
     WHERE p.id = $1 AND p.org_id = $2 AND tm.login = $3
     LIMIT 1`,
    [projectId.trim(), orgId.trim(), n]
  )
  return result != null && result.rows.length > 0
}

/**
 * Check if user has access to a project by project_key.
 * Org admin: always allowed. Else: project must exist and user must be in a team with access.
 */
export async function userHasProjectKeyAccess(
  login: string | undefined | null,
  orgId: string,
  projectKey: string
): Promise<boolean> {
  const n = normalizeLogin(login)
  if (!n || !orgId?.trim() || !projectKey?.trim()) return false

  const role = await getUserOrgRole(n, orgId.trim())
  if (role === "admin") return true

  const project = await getProjectByKey(orgId.trim(), projectKey.trim())
  if (!project) return false

  return userHasProjectAccess(n, orgId, project.id)
}
