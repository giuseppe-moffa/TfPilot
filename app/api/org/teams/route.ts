/**
 * GET /api/org/teams — Teams for active org (org-admin only).
 * POST /api/org/teams — Create team (org-admin only).
 * Requires session.orgId. Org_id comes only from session.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import {
  listTeamsWithCounts,
  listTeamMembers,
  createTeam,
  getTeamBySlug,
} from "@/lib/db/teams"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"

async function requireOrgAdmin() {
  const session = await getSessionFromCookies()
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  if (!session.orgId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return { error: archivedRes }
  const role = await getUserOrgRole(session.login, session.orgId)
  if (role !== "admin") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { session }
}

export async function GET() {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  const teams = await listTeamsWithCounts(session!.orgId!)
  const teamsWithMembers = await Promise.all(
    teams.map(async (t) => {
      const members = await listTeamMembers(t.id)
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description ?? null,
        createdAt: t.createdAt,
        membersCount: t.membersCount,
        members: members.map((m) => ({ login: m.login })),
      }
    })
  )

  return NextResponse.json({ teams: teamsWithMembers })
}

export async function POST(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { slug?: unknown; name?: unknown; description?: unknown }
  try {
    body = (await req.json()) as { slug?: unknown; name?: unknown; description?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawSlug = typeof body.slug === "string" ? body.slug.trim() : ""
  const normalizedSlug = rawSlug.toLowerCase()
  if (!normalizedSlug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 })
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : ""
  if (!rawName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const rawDescription =
    typeof body.description === "string" ? body.description.trim() || null : null

  const existing = await getTeamBySlug(session!.orgId!, normalizedSlug)
  if (existing) {
    return NextResponse.json({ error: "Team slug already exists" }, { status: 400 })
  }

  const team = await createTeam(session!.orgId!, normalizedSlug, rawName, rawDescription)
  if (!team) {
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 })
  }

  writeAuditEvent(auditWriteDeps, {
    org_id: session!.orgId!,
    actor_login: session!.login,
    source: "user",
    event_type: "team_created",
    entity_type: "team",
    entity_id: team.id,
    metadata: { team_slug: team.slug, name: team.name },
  }).catch(() => {})

  return NextResponse.json({
    team: {
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description ?? null,
      createdAt: team.createdAt,
    },
  })
}
