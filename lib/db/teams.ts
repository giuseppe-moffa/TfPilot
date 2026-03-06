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
  name: string
): Promise<Team | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !slug?.trim() || !name?.trim()) return null
  const id = generateTeamId()
  const normalizedSlug = slug.trim().toLowerCase()
  const result = await query<Team>(
    `INSERT INTO teams (id, org_id, slug, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id, org_id AS "orgId", slug, name, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, orgId.trim(), normalizedSlug, name.trim()]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * List teams for an org. Returns empty array when DB not configured.
 */
export async function listTeams(orgId: string): Promise<Team[]> {
  if (!isDatabaseConfigured() || !orgId?.trim()) return []
  const result = await query<Team>(
    `SELECT id, org_id AS "orgId", slug, name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM teams WHERE org_id = $1 ORDER BY name`,
    [orgId.trim()]
  )
  if (!result) return []
  return result.rows
}

/**
 * Get team by org and slug. Returns null when not found.
 */
export async function getTeamBySlug(orgId: string, slug: string): Promise<Team | null> {
  if (!isDatabaseConfigured() || !orgId?.trim() || !slug?.trim()) return null
  const normalizedSlug = slug.trim().toLowerCase()
  const result = await query<Team>(
    `SELECT id, org_id AS "orgId", slug, name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM teams WHERE org_id = $1 AND slug = $2`,
    [orgId.trim(), normalizedSlug]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0]!
}

/**
 * Add a member to a team. ON CONFLICT DO NOTHING (idempotent).
 */
export async function addTeamMember(teamId: string, login: string): Promise<void> {
  if (!isDatabaseConfigured() || !teamId?.trim() || !login?.trim()) return
  const normalizedLogin = login.trim().toLowerCase()
  await query(
    `INSERT INTO team_memberships (team_id, login, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (team_id, login) DO NOTHING`,
    [teamId.trim(), normalizedLogin]
  )
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
