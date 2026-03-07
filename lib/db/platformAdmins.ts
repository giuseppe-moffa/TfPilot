/**
 * Data access for platform_admins table.
 * Platform admins can list/create/archive/restore orgs.
 * Replaces legacy TFPILOT_ADMINS env-based gating.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

/**
 * List all platform admin logins. Returns empty array when DB not configured.
 */
export async function listPlatformAdmins(): Promise<string[]> {
  if (!isDatabaseConfigured()) return []
  const result = await query<{ login: string }>(
    "SELECT login FROM platform_admins ORDER BY login"
  )
  if (!result) return []
  return result.rows.map((r) => r.login)
}

/**
 * Check if a login is a platform admin. Returns false when DB not configured.
 */
export async function isPlatformAdmin(login: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !login?.trim()) return false
  const normalized = login.trim().toLowerCase()
  const result = await query<{ ok: number }>(
    "SELECT 1 AS ok FROM platform_admins WHERE login = $1 LIMIT 1",
    [normalized]
  )
  return result != null && result.rows.length > 0
}
