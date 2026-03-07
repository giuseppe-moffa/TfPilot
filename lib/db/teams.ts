/**
 * Data access for teams and team_memberships tables.
 * Step 2 of Teams support. DB helpers only; no API routes, no enforcement.
 */

import crypto from "node:crypto"

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export type Team = {
  id: string
  orgId: string
  slug: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export type TeamMember = {
  teamId: string
  login: string
  createdAt: string
}

function generateTeamId(): string {
  return `team_${crypto.randomBytes(12).toString("hex")}`
}

/**
 * Create a team. Returns the created team or null when DB not configured.
 */
export async function createTeam(
  orgId: string,
  slug: string,
  name: string,
  description?: string | null
): Promise<Team | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !slug?.trim() || !name?.trim()) return null
  const id = generateTeamId()
  const normalizedSlug = slug.trim().toLowerCase()
  const desc = typeof description === "string" ? description.trim() || null : null
  const result = await query<Team>(
    `INSERT INTO teams (id, org_id, slug, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id, org_id AS "orgId", slug, name, description, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, orgId.trim(), normalizedSlug, name.trim(), desc]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

export type TeamWithCount = {
  id: string
  orgId: string
  slug: string
  name: string
  description: string | null
  createdAt: string
  membersCount: number
}

/**
 * List teams for an org with member counts. Returns empty array when DB not configured.
 */
export async function listTeamsWithCounts(orgId: string): Promise<TeamWithCount[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<TeamWithCount>(
    `SELECT t.id, t.org_id AS "orgId", t.slug, t.name, t.description, t.created_at AS "createdAt",
            COUNT(m.login)::int AS "membersCount"
     FROM teams t
     LEFT JOIN team_memberships m ON m.team_id = t.id
     WHERE t.org_id = $1
     GROUP BY t.id, t.org_id, t.slug, t.name, t.description, t.created_at
     ORDER BY t.name`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

/**
 * List teams for an org. Returns empty array when DB not configured.
 */
export async function listTeams(orgId: string): Promise<Team[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<Team>(
    `SELECT id, org_id AS "orgId", slug, name, description, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM teams WHERE org_id = $1 ORDER BY name`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

/**
 * Update team name and description. Returns the updated team or null when not found.
 */
export async function updateTeam(
  teamId: string,
  updates: { name?: string; description?: string | null }
): Promise<Team | null> {
  if (!isDatabaseConfigured() || !teamId?.trim()) return null
  const name = typeof updates.name === "string" ? updates.name.trim() : undefined
  const desc =
    updates.description === undefined
      ? undefined
      : typeof updates.description === "string"
        ? updates.description.trim() || null
        : null
  if (!name && desc === undefined) return getTeamById(teamId)
  const sets: string[] = []
  const values: unknown[] = []
  let i = 1
  if (name) {
    sets.push(`name = $${i++}`)
    values.push(name)
  }
  if (desc !== undefined) {
    sets.push(`description = $${i++}`)
    values.push(desc)
  }
  if (sets.length === 0) return getTeamById(teamId)
  sets.push(`updated_at = NOW()`)
  values.push(teamId.trim())
  const result = await query<Team>(
    `UPDATE teams SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, org_id AS "orgId", slug, name, description, created_at AS "createdAt", updated_at AS "updatedAt"`,
    values
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Get team by ID. Returns null when not found.
 */
export async function getTeamById(teamId: string): Promise<Team | null> {
  if (!isDatabaseConfigured() || !teamId?.trim()) return null
  const result = await query<Team>(
    `SELECT id, org_id AS "orgId", slug, name, description, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM teams WHERE id = $1`,
    [teamId.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Get team by org and slug. Returns null when not found.
 */
export async function getTeamBySlug(orgId: string, slug: string): Promise<Team | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !slug?.trim()) return null
  const normalizedSlug = slug.trim().toLowerCase()
  const result = await query<Team>(
    `SELECT id, org_id AS "orgId", slug, name, description, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM teams WHERE org_id = $1 AND slug = $2`,
    [orgId.trim(), normalizedSlug]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Add a member to a team. ON CONFLICT DO NOTHING (idempotent).
 * Returns true if a row was inserted, false if already existed.
 */
export async function addTeamMember(teamId: string, login: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !teamId?.trim() || !login?.trim()) return false
  const normalizedLogin = login.trim().toLowerCase()
  const result = await query(
    `INSERT INTO team_memberships (team_id, login, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (team_id, login) DO NOTHING`,
    [teamId.trim(), normalizedLogin]
  )
  return result != null && (result.rowCount ?? 0) > 0
}

/**
 * Remove a member from a team. Returns true if a row was deleted.
 */
export async function removeTeamMember(teamId: string, login: string): Promise<boolean> {
  if (!isDatabaseConfigured() || !teamId?.trim() || !login?.trim()) return false
  const result = await query(
    "DELETE FROM team_memberships WHERE team_id = $1 AND login = $2",
    [teamId.trim(), login.trim().toLowerCase()]
  )
  return result != null && (result.rowCount ?? 0) > 0
}

/**
 * List team IDs for a user in an org. Used by permission context builder.
 * Returns empty array when DB not configured.
 */
export async function getTeamIdsForUserInOrg(orgId: string, login: string): Promise<string[]> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !login?.trim()) return []
  const normalizedLogin = login.trim().toLowerCase()
  const result = await query<{ id: string }>(
    `SELECT t.id
     FROM teams t
     JOIN team_memberships tm ON tm.team_id = t.id
     WHERE t.org_id = $1 AND tm.login = $2`,
    [orgId.trim(), normalizedLogin]
  )
  if (!result) return []
  return result.rows.map((r) => r.id)
}

/**
 * List members of a team. Returns empty array when DB not configured.
 */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  if (!isDatabaseConfigured() || !teamId?.trim()) return []
  const result = await query<TeamMember>(
    `SELECT team_id AS "teamId", login, created_at AS "createdAt"
     FROM team_memberships WHERE team_id = $1 ORDER BY login`,
    [teamId.trim()]
  )
  if (!result) return []
  return result.rows
}
