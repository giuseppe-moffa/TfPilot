/**
 * Data access for projects table.
 * Org-scoped project registry.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type ProjectSummary = {
  id: string
  projectKey: string
  name: string
}

/**
 * Count projects for an org. Returns 0 when DB not configured.
 */
export async function countProjectsByOrg(orgId: string): Promise<number> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return 0
  const result = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM projects WHERE org_id = $1",
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return 0
  const n = parseInt(result.rows[0]!.count, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * List projects for an org. Returns empty array when DB not configured.
 */
export async function listProjectsByOrg(orgId: string): Promise<ProjectSummary[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<ProjectSummary>(
    `SELECT id, project_key AS "projectKey", name
     FROM projects WHERE org_id = $1 ORDER BY project_key`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

export type Project = {
  id: string
  orgId: string
  projectKey: string
  name: string
}

/**
 * Get project by org and project_key. Returns null when not found.
 */
export async function getProjectByKey(orgId: string, projectKey: string): Promise<Project | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !projectKey?.trim()) return null
  const result = await query<{ id: string; org_id: string; project_key: string; name: string }>(
    "SELECT id, org_id, project_key, name FROM projects WHERE org_id = $1 AND project_key = $2",
    [orgId.trim(), projectKey.trim()]
  )
  if (!result || result.rows.length === 0) return null
  const r = result.rows[0]!
  return { id: r.id, orgId: r.org_id, projectKey: r.project_key, name: r.name }
}

/**
 * Get project by ID. Returns null when not found.
 */
export async function getProjectById(projectId: string): Promise<Project | null> {
  if (!isDatabaseConfigured() || !projectId?.trim()) return null
  const result = await query<{ id: string; org_id: string; project_key: string; name: string }>(
    "SELECT id, org_id, project_key, name FROM projects WHERE id = $1",
    [projectId.trim()]
  )
  if (!result || result.rows.length === 0) return null
  const r = result.rows[0]!
  return { id: r.id, orgId: r.org_id, projectKey: r.project_key, name: r.name }
}
