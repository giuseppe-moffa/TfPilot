/**
 * Org-scoped role resolver. Queries org_memberships table.
 * Does NOT read from session. Does NOT replace getUserRole yet.
 */

import { query } from "@/lib/db/pg"

export type OrgRole = "viewer" | "developer" | "approver" | "admin"

const VALID_ROLES: OrgRole[] = ["viewer", "developer", "approver", "admin"]

function isValidRole(r: unknown): r is OrgRole {
  return typeof r === "string" && VALID_ROLES.includes(r as OrgRole)
}

/**
 * Resolve a user's role within a specific org.
 * @param login - GitHub login
 * @param orgId - Org id (e.g. "default")
 * @returns role string or null if no membership. Returns null when DB not configured (explicit path).
 *          Actual DB errors propagate; no silent masking.
 */
export async function getUserOrgRole(
  login: string,
  orgId: string
): Promise<OrgRole | null> {
  if (!login?.trim() || !orgId?.trim()) return null

  const result = await query<{ role: string }>(
    "SELECT role FROM org_memberships WHERE org_id = $1 AND login = $2",
    [orgId.trim(), login.trim()]
  )
  // null only when DB not configured (explicit path). Actual DB errors propagate.
  if (!result || result.rows.length === 0) return null
  const role = result.rows[0]?.role
  return isValidRole(role) ? role : null
}
