/**
 * Data access for the Workspaces table (renamed from Environments).
 * A Workspace is the deployable Terraform root + state boundary.
 */

import crypto from "node:crypto"

/** Postgres unique_violation error code. Used for 409 Conflict on duplicate workspace. */
export const PG_UNIQUE_VIOLATION = "23505"
import { isDatabaseConfigured } from "./config"
import { query } from "./pg"
import { validateWorkspaceSlug } from "@/lib/workspaces/helpers"

export type Workspace = {
  workspace_id: string
  org_id: string
  project_key: string
  repo_full_name: string
  workspace_key: string
  workspace_slug: string
  template_id: string
  template_version: string
  /** Pinned create-time template input values (resolved, with defaults). */
  template_inputs: Record<string, unknown>
  created_at: string
  updated_at: string
  archived_at: string | null
}

function generateWorkspaceId(): string {
  return `ws_${crypto.randomBytes(12).toString("hex")}`
}

/**
 * Create a workspace row. Validates slug format.
 * Returns the created Workspace or null if DB not configured.
 */
export async function createWorkspace(params: {
  orgId: string
  project_key: string
  repo_full_name: string
  workspace_key: string
  workspace_slug: string
  template_id: string
  template_version: string
  template_inputs: Record<string, unknown>
}): Promise<Workspace | null> {
  if (!isDatabaseConfigured()) return null

  const slugResult = validateWorkspaceSlug(params.workspace_slug)
  if (!slugResult.ok) {
    throw new Error(slugResult.error)
  }

  const id = generateWorkspaceId()
  const now = new Date().toISOString()
  const templateInputsJson =
    typeof params.template_inputs === "object" && params.template_inputs !== null
      ? JSON.stringify(params.template_inputs)
      : "{}"
  const result = await query<Workspace>(
    `INSERT INTO workspaces (
      workspace_id, org_id, project_key, repo_full_name, workspace_key, workspace_slug,
      template_id, template_version, template_inputs, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
    RETURNING *`,
    [
      id,
      params.orgId,
      params.project_key,
      params.repo_full_name,
      params.workspace_key,
      params.workspace_slug,
      params.template_id,
      params.template_version,
      templateInputsJson,
      now,
    ]
  )
  if (!result || result.rows.length === 0) return null
  return normalizeTemplateInputs(result.rows[0]!)
}

/**
 * Ensures template_inputs is always Record<string, unknown>.
 * All workspace reads go through this so callers never need to parse or normalize.
 */
function normalizeTemplateInputs(row: Workspace): Workspace {
  const raw = (row as { template_inputs?: unknown }).template_inputs
  if (raw === undefined || raw === null) {
    (row as { template_inputs: unknown }).template_inputs = {}
    return row
  }
  if (typeof raw === "string") {
    try {
      (row as { template_inputs: unknown }).template_inputs = JSON.parse(raw) as Record<string, unknown>
    } catch {
      (row as { template_inputs: unknown }).template_inputs = {}
    }
  }
  return row
}

/**
 * Get workspace by ID. Returns null if not found or DB not configured.
 */
export async function getWorkspaceById(workspace_id: string): Promise<Workspace | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<Workspace>(
    "SELECT * FROM workspaces WHERE workspace_id = $1",
    [workspace_id]
  )
  if (!result || result.rows.length === 0) return null
  return normalizeTemplateInputs(result.rows[0]!)
}

/**
 * Get workspace by (repo_full_name, workspace_key, workspace_slug).
 * Used for 409 response when unique constraint is violated.
 */
export async function getWorkspaceByRepoKeySlug(params: {
  repo_full_name: string
  workspace_key: string
  workspace_slug: string
}): Promise<Workspace | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<Workspace>(
    "SELECT * FROM workspaces WHERE repo_full_name = $1 AND workspace_key = $2 AND workspace_slug = $3",
    [params.repo_full_name, params.workspace_key, params.workspace_slug]
  )
  if (!result || result.rows.length === 0) return null
  return normalizeTemplateInputs(result.rows[0]!)
}

/**
 * Archive a workspace (set archived_at). Used after workspace destroy succeeds.
 */
export async function archiveWorkspace(workspace_id: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false
  const now = new Date().toISOString()
  const result = await query<Workspace>(
    "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE workspace_id = $2 RETURNING *",
    [now, workspace_id]
  )
  return !!(result && result.rowCount && result.rowCount > 0)
}

/**
 * List workspaces. Filters by orgId and/or project_key if provided.
 * Excludes archived by default. Returns null if DB not configured.
 */
export async function listWorkspaces(options?: {
  orgId?: string
  project_key?: string
  include_archived?: boolean
}): Promise<Workspace[] | null> {
  if (!isDatabaseConfigured()) return null

  const orgId = options?.orgId
  const project_key = options?.project_key
  const include_archived = options?.include_archived ?? false

  let sql = "SELECT * FROM workspaces WHERE 1=1"
  const values: unknown[] = []
  let i = 1

  if (orgId) {
    sql += ` AND org_id = $${i++}`
    values.push(orgId)
  }
  if (project_key) {
    sql += ` AND project_key = $${i++}`
    values.push(project_key)
  }
  if (!include_archived) {
    sql += " AND archived_at IS NULL"
  }
  sql += " ORDER BY created_at DESC"

  const result = await query<Workspace>(sql, values)
  if (!result) return null
  return result.rows.map(normalizeTemplateInputs)
}
