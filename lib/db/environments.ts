/**
 * Data access for Model 2 Environments table.
 * Phase 0 scaffolding. Not wired into request flows.
 */

import crypto from "node:crypto"

/** Postgres unique_violation error code. Used for 409 Conflict on duplicate env. */
export const PG_UNIQUE_VIOLATION = "23505"
import { isDatabaseConfigured } from "./config"
import { query } from "./pg"
import { validateEnvironmentSlug } from "@/lib/environments/helpers"

export type Environment = {
  environment_id: string
  org_id: string
  project_key: string
  repo_full_name: string
  environment_key: string
  environment_slug: string
  template_id: string | null
  template_version: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

function generateEnvironmentId(): string {
  return `env_${crypto.randomBytes(12).toString("hex")}`
}

/**
 * Create an environment row. Validates slug format.
 * Returns the created Environment or null if DB not configured.
 */
export async function createEnvironment(params: {
  orgId: string
  project_key: string
  repo_full_name: string
  environment_key: string
  environment_slug: string
  template_id?: string | null
  template_version?: string | null
}): Promise<Environment | null> {
  if (!isDatabaseConfigured()) return null

  const slugResult = validateEnvironmentSlug(params.environment_slug)
  if (!slugResult.ok) {
    throw new Error(slugResult.error)
  }

  const id = generateEnvironmentId()
  const now = new Date().toISOString()
  const result = await query<Environment>(
    `INSERT INTO environments (
      environment_id, org_id, project_key, repo_full_name, environment_key, environment_slug,
      template_id, template_version, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    RETURNING *`,
    [
      id,
      params.orgId,
      params.project_key,
      params.repo_full_name,
      params.environment_key,
      params.environment_slug,
      params.template_id ?? null,
      params.template_version ?? null,
      now,
    ]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Get environment by ID. Returns null if not found or DB not configured.
 */
export async function getEnvironmentById(environment_id: string): Promise<Environment | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<Environment>(
    "SELECT * FROM environments WHERE environment_id = $1",
    [environment_id]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Get environment by (repo_full_name, environment_key, environment_slug).
 * Used for 409 response when unique constraint is violated.
 */
export async function getEnvironmentByRepoKeySlug(params: {
  repo_full_name: string
  environment_key: string
  environment_slug: string
}): Promise<Environment | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<Environment>(
    "SELECT * FROM environments WHERE repo_full_name = $1 AND environment_key = $2 AND environment_slug = $3",
    [params.repo_full_name, params.environment_key, params.environment_slug]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Archive an environment (set archived_at). Used after env destroy succeeds.
 */
export async function archiveEnvironment(environment_id: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false
  const now = new Date().toISOString()
  const result = await query<Environment>(
    "UPDATE environments SET archived_at = $1, updated_at = $1 WHERE environment_id = $2 RETURNING *",
    [now, environment_id]
  )
  return !!(result && result.rowCount && result.rowCount > 0)
}

/**
 * List environments. Filters by orgId and/or project_key if provided.
 * Excludes archived by default. Returns null if DB not configured.
 */
export async function listEnvironments(options?: {
  orgId?: string
  project_key?: string
  include_archived?: boolean
}): Promise<Environment[] | null> {
  if (!isDatabaseConfigured()) return null

  const orgId = options?.orgId
  const project_key = options?.project_key
  const include_archived = options?.include_archived ?? false

  let sql = "SELECT * FROM environments WHERE 1=1"
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

  const result = await query<Environment>(sql, values)
  if (!result) return null
  return result.rows
}
