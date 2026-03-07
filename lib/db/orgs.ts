/**
 * Data access for orgs and org_memberships tables.
 */

import crypto from "node:crypto"

import { isDatabaseConfigured } from "./config"
import { query, withClient } from "./pg"

export type Org = {
  id: string
  slug: string
  name: string
  created_at: string
  updated_at: string
  archived_at: string | null
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
  const result = await query<Org & { archived_at: string | null }>(
    "SELECT id, slug, name, created_at, updated_at, archived_at FROM orgs WHERE id = $1",
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Get org by slug. Returns null when DB not configured or org not found.
 */
export async function getOrgBySlug(slug: string): Promise<Org | null> {
  if (!isDatabaseConfigured() || !slug?.trim()) return null
  const result = await query<Org>(
    "SELECT id, slug, name, created_at, updated_at, archived_at FROM orgs WHERE slug = $1",
    [slug.trim().toLowerCase()]
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
 * By default excludes archived orgs (for org switcher).
 */
export type UserOrg = { orgId: string; orgSlug: string; orgName: string }

export type ListUserOrgsOptions = { excludeArchived?: boolean }

export async function listUserOrgs(
  login: string,
  options?: ListUserOrgsOptions
): Promise<UserOrg[]> {
  if (!isDatabaseConfigured() || !login?.trim()) return []
  const excludeArchived = options?.excludeArchived !== false
  const result = await query<UserOrg>(
    `SELECT o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName"
     FROM org_memberships m
     JOIN orgs o ON o.id = m.org_id
     WHERE m.login = $1
     ${excludeArchived ? "AND o.archived_at IS NULL" : ""}
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
 * List all orgs with member counts. Platform-admin only.
 * Ordered by created_at DESC for consistency with admin views.
 * Default: only active orgs (archived_at IS NULL).
 */
export type OrgWithCount = {
  id: string
  slug: string
  name: string
  createdAt: string
  memberCount: number
  archivedAt: string | null
}

export type ListAllOrgsFilter = "active" | "archived" | "all"

export type ListAllOrgsOptions = {
  filter?: ListAllOrgsFilter
}

export async function listAllOrgsWithCounts(
  options?: ListAllOrgsOptions
): Promise<OrgWithCount[]> {
  if (!isDatabaseConfigured()) return []
  const filter = options?.filter ?? "active"
  const archivedFilter =
    filter === "active"
      ? " AND o.archived_at IS NULL"
      : filter === "archived"
        ? " AND o.archived_at IS NOT NULL"
        : ""
  const result = await query<{
    id: string
    slug: string
    name: string
    created_at: string
    member_count: string
    archived_at: string | null
  }>(
    `SELECT o.id, o.slug, o.name, o.created_at, o.archived_at,
            COUNT(m.login)::text AS member_count
     FROM orgs o
     LEFT JOIN org_memberships m ON m.org_id = o.id
     WHERE 1=1${archivedFilter}
     GROUP BY o.id, o.slug, o.name, o.created_at, o.archived_at
     ORDER BY o.created_at DESC`,
    []
  )
  if (!result) return []
  return result.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdAt: r.created_at,
    memberCount: parseInt(r.member_count, 10) || 0,
    archivedAt: r.archived_at,
  }))
}

/**
 * Check if org is archived. Returns false when DB not configured or org not found.
 */
export async function isOrgArchived(orgId: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return false
  const result = await query<{ archived_at: string | null }>(
    "SELECT archived_at FROM orgs WHERE id = $1",
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return false
  return result.rows[0]!.archived_at != null
}

/**
 * Soft-archive an org. Sets archived_at = NOW().
 * Idempotent: repeated archive returns ok.
 */
export async function archiveOrg(orgId: string): Promise<{
  ok: true
  archivedAt: string
} | { ok: false }> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return { ok: false }
  const result = await query<{ archived_at: string }>(
    `UPDATE orgs SET archived_at = COALESCE(archived_at, NOW()) WHERE id = $1
     RETURNING archived_at`,
    [orgId.trim()]
  )
  if (!result || result.rows.length === 0) return { ok: false }
  return { ok: true, archivedAt: result.rows[0]!.archived_at }
}

/**
 * Restore an archived org. Sets archived_at = NULL.
 * Idempotent: repeated restore on already-active org returns ok.
 */
export async function restoreOrg(orgId: string): Promise<{
  ok: true
  archivedAt: null
} | { ok: false }> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return { ok: false }
  const result = await query(
    "UPDATE orgs SET archived_at = NULL WHERE id = $1",
    [orgId.trim()]
  )
  if (!result || result.rowCount === undefined) return { ok: false }
  return { ok: true, archivedAt: null }
}

function generateOrgId(): string {
  return `org_${crypto.randomBytes(12).toString("hex")}`
}

export type CreateOrgWithInitialAdminResult =
  | { ok: true; org: OrgWithCount }
  | { ok: false; error: "slug_exists" | "db_error" }

/**
 * Create org and first admin membership atomically. Platform-admin only.
 * slug/name/adminLogin must already be normalized (trimmed, slug/adminLogin lowercased).
 */
export async function createOrgWithInitialAdmin(
  slug: string,
  name: string,
  adminLogin: string
): Promise<CreateOrgWithInitialAdminResult> {
  if (!isDatabaseConfigured() || !slug || !name || !adminLogin) {
    return { ok: false, error: "db_error" }
  }
  const existing = await getOrgBySlug(slug)
  if (existing) return { ok: false, error: "slug_exists" }

  const result = await withClient(async (client) => {
    await client.query("BEGIN")
    try {
      const id = generateOrgId()
      await client.query(
        `INSERT INTO orgs (id, slug, name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, slug, name]
      )
      await client.query(
        `INSERT INTO org_memberships (org_id, login, role, created_at)
         VALUES ($1, $2, 'admin', NOW())`,
        [id, adminLogin]
      )
      const orgRow = await client.query(
        "SELECT id, slug, name, created_at, archived_at FROM orgs WHERE id = $1",
        [id]
      )
      await client.query("COMMIT")
      const r = orgRow.rows[0]
      if (!r) return null
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        createdAt: r.created_at,
        memberCount: 1,
        archivedAt: null,
      }
    } catch {
      await client.query("ROLLBACK")
      return null
    }
  })

  if (result === null) return { ok: false, error: "db_error" }
  return { ok: true, org: result }
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
