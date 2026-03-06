/**
 * Resolve active org for a login from org_memberships + orgs.
 * Used during login to attach orgId/orgSlug to session.
 */

import { query } from "@/lib/db/pg"

/**
 * Resolve the active org for a user at login.
 * - 0 memberships → null (deny login)
 * - 1 membership → use that org
 * - multiple → prefer org id = "default", else first by org_id (stable ordering)
 *
 * Returns null when DB not configured or query fails (fail-closed).
 */
export async function resolveActiveOrgForLogin(
  login: string
): Promise<{ orgId: string; orgSlug: string } | null> {
  if (!login?.trim()) return null

  const result = await query<{ org_id: string; org_slug: string }>(
    `SELECT o.id AS org_id, o.slug AS org_slug
     FROM org_memberships m
     JOIN orgs o ON m.org_id = o.id
     WHERE m.login = $1
     ORDER BY CASE WHEN o.id = 'default' THEN 0 ELSE 1 END, o.id`,
    [login.trim()]
  )

  if (!result || result.rows.length === 0) return null

  const row = result.rows[0]
  if (!row?.org_id || !row?.org_slug) return null

  return { orgId: row.org_id, orgSlug: row.org_slug }
}
