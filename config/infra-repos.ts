/**
 * Default workspace environment keys.
 * Previously: static registry (core/payments) — migrated to project DB.
 * Repo resolution now uses projects.repo_full_name and projects.default_branch.
 */

export const DEFAULT_WORKSPACE_KEYS = ["dev", "prod"] as const
