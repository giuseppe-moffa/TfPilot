/**
 * GET /api/org/teams/access — List project-team grants (org-admin only).
 * POST /api/org/teams/access — Grant access (org-admin only).
 * DELETE /api/org/teams/access — Revoke access (org-admin only).
 * Requires session.orgId. Validates team and project belong to org.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import { getTeamById } from "@/lib/db/teams"
import { getProjectById } from "@/lib/db/projects"
import {
  listProjectTeamAccessByOrg,
  grantProjectTeamAccess,
  revokeProjectTeamAccess,
} from "@/lib/db/projectTeamAccess"

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

  const grants = await listProjectTeamAccessByOrg(session!.orgId!)

  return NextResponse.json({
    grants: grants.map((g) => ({ teamId: g.teamId, projectId: g.projectId })),
  })
}

export async function POST(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { teamId?: unknown; projectId?: unknown }
  try {
    body = (await req.json()) as { teamId?: unknown; projectId?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : ""
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
  if (!teamId || !projectId) {
    return NextResponse.json({ error: "teamId and projectId are required" }, { status: 400 })
  }

  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const project = await getProjectById(projectId)
  if (!project || project.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await grantProjectTeamAccess(projectId, teamId)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { teamId?: unknown; projectId?: unknown }
  try {
    body = (await req.json()) as { teamId?: unknown; projectId?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : ""
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
  if (!teamId || !projectId) {
    return NextResponse.json({ error: "teamId and projectId are required" }, { status: 400 })
  }

  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const project = await getProjectById(projectId)
  if (!project || project.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await revokeProjectTeamAccess(projectId, teamId)
  return NextResponse.json({ ok: true })
}
