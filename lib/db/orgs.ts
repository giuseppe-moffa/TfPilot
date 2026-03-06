/**
 * Data access for orgs and org_memberships tables.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type Org = {
  id: string
  slug: string
  name: string
  created_at: string
  updated_at: string
}

export type OrgMember = {
  login: string
  role: string
  created_at: string
}

const VALID_ORG_ROLES = ["viewer", "developer", "approver", "admin"] as const

export function isValidOrgRole(r: unknown): r is (typeof VALID_ORG_ROLES)[number] {
  return typeof r === "string" && VALID_ORG_ROLES.includes(r as (typeof VALID_ORG_ROLES)[number])
}

/**
 * Get org by ID. Returns null when DB not configured or org not found.
 */
export async function getOrgById(orgId: string): Promise<Org | null> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return null
  const result = await query<Org>(
    "SELECT id, slug, name, created_at, updated_at FROM orgs WHERE id = $1",
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * List members for an org. Returns empty array when DB not configured.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<OrgMember>(
    "SELECT login, role, created_at FROM org_memberships WHERE org_id = $1 ORDER BY created_at ASC",
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

/**
 * Create or update org membership. Uses session.orgId only; org_id never from client.
 * On conflict (org_id, login): updates role only; created_at preserved.
 * Returns the member row or null when DB not configured.
 */
export async function upsertOrgMember(
  orgId: string,
  login: string,
  role: string
): Promise<OrgMember | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !login?.trim() || !role?.trim()) return null
  const result = await query<OrgMember>(
    `INSERT INTO org_memberships (org_id, login, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (org_id, login) DO UPDATE SET role = EXCLUDED.role
     RETURNING login, role, created_at`,
    [orgId.trim(), login.trim().toLowerCase(), role.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Count admins in an org. Used for last-admin protection.
 */
export async function countOrgAdmins(orgId: string): Promise<number> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return 0
  const result = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM org_memberships WHERE org_id = $1 AND role = 'admin'",
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return 0
  const n = parseInt(result.rows[0]!.count, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Get a single org member. Returns null if not found.
 */
export async function getOrgMember(orgId: string, login: string): Promise<OrgMember | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !login?.trim()) return null
  const result = await query<OrgMember>(
    "SELECT login, role, created_at FROM org_memberships WHERE org_id = $1 AND login = $2",
    [orgId.trim(), login.trim().toLowerCase()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Update a member's role. Returns updated member or null.
 */
export async function updateOrgMemberRole(
  orgId: string,
  login: string,
  role: string
): Promise<OrgMember | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !login?.trim() || !role?.trim()) return null
  const result = await query<OrgMember>(
    `UPDATE org_memberships SET role = $3 WHERE org_id = $1 AND login = $2
     RETURNING login, role, created_at`,
    [orgId.trim(), login.trim().toLowerCase(), role.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * List orgs a user belongs to. Returns orgId, orgSlug, orgName for each.
 */
export type UserOrg = { orgId: string; orgSlug: string; orgName: string }

export async function listUserOrgs(login: string): Promise<UserOrg[]> {
  if (!isDatabaseConfigured() || !login?.trim()) return []
  const result = await query<UserOrg>(
    `SELECT o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName"
     FROM org_memberships m
     JOIN orgs o ON o.id = m.org_id
     WHERE m.login = $1
     ORDER BY o.slug`,
    [login.trim().toLowerCase()]
  )
  if (!result) return []
  return result.rows
}

/**
 * Get org info if user is a member. Returns null if not a member or org not found.
 */
export async function getUserOrg(login: string, orgId: string): Promise<UserOrg | null> {
  if (!isDatabaseConfigured() || !login?.trim() || !orgId?.trim()) return null
  const member = await getOrgMember(orgId.trim(), login.trim().toLowerCase())
  if (!member) return null
  const org = await getOrgById(orgId.trim())
  if (!org) return null
  return { orgId: org.id, orgSlug: org.slug, orgName: org.name }
}

/**
 * Delete an org membership. Returns true if a row was deleted.
 */
export async function deleteOrgMember(orgId: string, login: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !login?.trim()) return false
  const result = await query(
    "DELETE FROM org_memberships WHERE org_id = $1 AND login = $2",
    [orgId.trim(), login.trim().toLowerCase()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}
