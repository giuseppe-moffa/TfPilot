/**
 * Org-aware project resolver. Reads from projects table.
 * Does NOT fall back to config/infra-repos.ts. Does NOT replace callers yet.
 */

import { query } from "@/lib/db/pg"

export type ProjectRepoConfig = {
  repoFullName: string
  defaultBranch: string
}

/**
 * Resolve project repo config by org and project key.
 * @param orgId - Org id (e.g. "default")
 * @param projectKey - Project key (e.g. "core")
 * @returns config or null if not found, empty inputs, or DB not configured
 */
export async function getProjectRepo(
  orgId: string,
  projectKey: string
): Promise<ProjectRepoConfig | null> {
  if (!orgId?.trim() || !projectKey?.trim()) return null

  const result = await query<{ repo_full_name: string; default_branch: string }>(
    `SELECT repo_full_name, default_branch
     FROM projects
     WHERE org_id = $1 AND project_key = $2`,
    [orgId.trim(), projectKey.trim()]
  )

  if (!result || result.rows.length === 0) return null

  const row = result.rows[0]
  if (!row?.repo_full_name || !row?.default_branch) return null

  return {
    repoFullName: row.repo_full_name,
    defaultBranch: row.default_branch,
  }
}
