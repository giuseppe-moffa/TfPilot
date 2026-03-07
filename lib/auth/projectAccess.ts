/**
 * Project access checks via org admin or team membership.
 * Resolves through: org admin short-circuit, team_memberships, project_team_access, projects.
 */

import type { OrgRole } from "@/lib/auth/orgRoles"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import type { Project } from "@/lib/db/projects"
import { getProjectByKey } from "@/lib/db/projects"
import { query } from "@/lib/db/pg"

function normalizeLogin(login?: string | null): string {
  return (login ?? "").trim().toLowerCase()
}

/** Dependencies for project access checks. Injected for testability. */
export type ProjectAccessDeps = {
  getUserOrgRole: (login: string, orgId: string) => Promise<OrgRole | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<Project | null>
  query: (text: string, values?: unknown[]) => Promise<{ rows: { ok?: number }[] } | null>
}

const realDeps: ProjectAccessDeps = {
  getUserOrgRole,
  getProjectByKey,
  query,
}

/**
 * Factory for project access functions. Used at runtime; inject deps for tests.
 */
export function createProjectAccess(deps: ProjectAccessDeps) {
  async function userHasProjectAccess(
    login: string | undefined | null,
    orgId: string,
    projectId: string
  ): Promise<boolean> {
    const n = normalizeLogin(login)
    if (!n || !orgId?.trim() || !projectId?.trim()) return false

    const role = await deps.getUserOrgRole(n, orgId.trim())
    if (role === "admin") return true

    const result = await deps.query(
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

  async function userHasProjectKeyAccess(
    login: string | undefined | null,
    orgId: string,
    projectKey: string
  ): Promise<boolean> {
    const n = normalizeLogin(login)
    if (!n || !orgId?.trim() || !projectKey?.trim()) return false

    const role = await deps.getUserOrgRole(n, orgId.trim())
    if (role === "admin") return true

    const project = await deps.getProjectByKey(orgId.trim(), projectKey.trim())
    if (!project) return false

    return userHasProjectAccess(n, orgId, project.id)
  }

  return { userHasProjectAccess, userHasProjectKeyAccess }
}

const access = createProjectAccess(realDeps)

/** Check if user has access to a project by ID. Org admin: always allowed. Else: team membership. */
export const userHasProjectAccess = access.userHasProjectAccess

/** Check if user has access to a project by project_key. Org admin: always allowed. Else: project exists + team. */
export const userHasProjectKeyAccess = access.userHasProjectKeyAccess
