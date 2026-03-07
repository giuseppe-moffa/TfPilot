/**
 * GET /api/org/teams/[teamId] — Team details with members (org-admin only).
 * PATCH /api/org/teams/[teamId] — Update team name and description (org-admin only).
 * Requires session.orgId. Verifies team belongs to org.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import { getTeamById, listTeamMembers, updateTeam } from "@/lib/db/teams"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  const role = await getUserOrgRole(session.login, session.orgId)
  if (role !== "admin") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { teamId } = await params
  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const members = await listTeamMembers(teamId)
  return NextResponse.json({
    team: {
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description ?? null,
      createdAt: team.createdAt,
      members: members.map((m) => ({ login: m.login })),
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  const role = await getUserOrgRole(session.login, session.orgId)
  if (role !== "admin") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { teamId } = await params
  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { name?: unknown; description?: unknown }
  try {
    body = (await req.json()) as { name?: unknown; description?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined
  const description =
    body.description === undefined
      ? undefined
      : body.description === null
        ? null
        : typeof body.description === "string"
          ? body.description.trim() || null
          : undefined

  if (!name && description === undefined) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 })
  }
  if (name && !name.length) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
  }

  const updated = await updateTeam(teamId, { name, description })
  if (!updated) {
    return NextResponse.json({ error: "Failed to update team" }, { status: 500 })
  }

  return NextResponse.json({
    team: {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description ?? null,
      createdAt: updated.createdAt,
    },
  })
}
