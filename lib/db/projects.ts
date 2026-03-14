/**
 * Data access for projects table.
 * Org-scoped project registry. Projects are first-class user-managed resources.
 */

import crypto from "node:crypto"
import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type ProjectSummary = {
  id: string
  projectKey: string
  name: string
}

export type Project = {
  id: string
  orgId: string
  projectKey: string
  name: string
  repoFullName: string
  defaultBranch: string
  createdAt: string
  updatedAt: string
}

/** Postgres unique_violation error code. */
export const PG_UNIQUE_VIOLATION = "23505"

/** Validates project_key: lowercase alphanumeric + hyphens, no leading/trailing hyphen, 1–64 chars. */
export function isValidProjectKey(key: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(key)
}

/** Validates repo_full_name: owner/repo format. */
export function isValidRepoFullName(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)
}

function generateProjectId(): string {
  return `proj_${crypto.randomBytes(12).toString("hex")}`
}

type ProjectRow = {
  id: string
  org_id: string
  project_key: string
  name: string
  repo_full_name: string
  default_branch: string
  created_at: string
  updated_at: string
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    orgId: r.org_id,
    projectKey: r.project_key,
    name: r.name,
    repoFullName: r.repo_full_name,
    defaultBranch: r.default_branch,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
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
 * List projects for an org (summary only). Returns empty array when DB not configured.
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

/**
 * Resolve project by id or project_key. Tries getProjectById first, then getProjectByKey.
 * Returns null when not found or org mismatch.
 */
export async function resolveProjectByIdOrKey(
  orgId: string,
  idOrKey: string
): Promise<Project | null> {
  if (!orgId?.trim() || !idOrKey?.trim()) return null
  const byId = await getProjectById(idOrKey)
  if (byId && byId.orgId === orgId) return byId
  return getProjectByKey(orgId, idOrKey)
}

/**
 * Get full project by org and project_key. Returns null when not found.
 */
export async function getProjectByKey(orgId: string, projectKey: string): Promise<Project | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !projectKey?.trim()) return null
  const result = await query<ProjectRow>(
    `SELECT id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at
     FROM projects WHERE org_id = $1 AND project_key = $2`,
    [orgId.trim(), projectKey.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return rowToProject(result.rows[0]!)
}

/**
 * Get full project by ID. Returns null when not found.
 */
export async function getProjectById(projectId: string): Promise<Project | null> {
  if (!isDatabaseConfigured() || !projectId?.trim()) return null
  const result = await query<ProjectRow>(
    `SELECT id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at
     FROM projects WHERE id = $1`,
    [projectId.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return rowToProject(result.rows[0]!)
}

export type OrphanedWorkspaceProjectKey = { org_id: string; project_key: string }

/**
 * List (org_id, project_key) pairs from workspaces that have no matching project row.
 * Used for admin audit — workspaces created before projects were first-class may reference
 * project_keys that were never inserted into projects. Optional orgId filters to one org.
 */
export async function listOrphanedWorkspaceProjectKeys(
  orgId?: string
): Promise<OrphanedWorkspaceProjectKey[]> {
  if (!isDatabaseConfigured()) return []
  const sql = orgId?.trim()
    ? `SELECT DISTINCT w.org_id, w.project_key
       FROM workspaces w
       LEFT JOIN projects p ON w.org_id = p.org_id AND w.project_key = p.project_key
       WHERE p.id IS NULL AND w.org_id = $1`
    : `SELECT DISTINCT w.org_id, w.project_key
       FROM workspaces w
       LEFT JOIN projects p ON w.org_id = p.org_id AND w.project_key = p.project_key
       WHERE p.id IS NULL`
  const values = orgId?.trim() ? [orgId.trim()] : []
  const result = await query<{ org_id: string; project_key: string }>(sql, values)
  if (!result) return []
  return result.rows
}

/**
 * Create a new project. Returns the created project or null if DB not configured.
 * Throws on unique_violation (org_id + project_key already exists).
 */
export async function createProject(params: {
  orgId: string
  projectKey: string
  name: string
  repoFullName: string
  defaultBranch: string
}): Promise<Project | null> {
  if (!isDatabaseConfigured()) return null
  const id = generateProjectId()
  const now = new Date().toISOString()
  const result = await query<ProjectRow>(
    `INSERT INTO projects (id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at`,
    [
      id,
      params.orgId.trim(),
      params.projectKey.trim(),
      params.name.trim(),
      params.repoFullName.trim(),
      params.defaultBranch.trim(),
      now,
    ]
  )
  if (!result || result.rows.length === 0) return null
  return rowToProject(result.rows[0]!)
}

/**
 * Update project metadata. Returns the updated project or null.
 */
export async function updateProject(
  projectId: string,
  updates: Partial<{ name: string; repoFullName: string; defaultBranch: string }>
): Promise<Project | null> {
  if (!isDatabaseConfigured() || !projectId?.trim()) return null
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  if (updates.name !== undefined) { sets.push(`name = $${idx++}`); values.push(updates.name.trim()) }
  if (updates.repoFullName !== undefined) { sets.push(`repo_full_name = $${idx++}`); values.push(updates.repoFullName.trim()) }
  if (updates.defaultBranch !== undefined) { sets.push(`default_branch = $${idx++}`); values.push(updates.defaultBranch.trim()) }
  if (sets.length === 0) return getProjectById(projectId)
  sets.push(`updated_at = $${idx++}`)
  values.push(new Date().toISOString())
  values.push(projectId.trim())
  const result = await query<ProjectRow>(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${idx}
     RETURNING id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at`,
    values
  )
  if (!result || result.rows.length === 0) return null
  return rowToProject(result.rows[0]!)
}
