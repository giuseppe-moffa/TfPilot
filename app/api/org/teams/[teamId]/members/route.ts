/**
 * POST /api/org/teams/[teamId]/members — Add member to team (org-admin only).
 * DELETE /api/org/teams/[teamId]/members — Remove member from team (org-admin only).
 * Requires session.orgId. Verifies team belongs to org.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import {
  getTeamById,
  addTeamMember,
  removeTeamMember,
} from "@/lib/db/teams"

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  const { teamId } = await params
  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { login?: unknown }
  try {
    body = (await req.json()) as { login?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawLogin = typeof body.login === "string" ? body.login.trim() : ""
  const normalizedLogin = rawLogin.toLowerCase()
  if (!normalizedLogin) {
    return NextResponse.json({ error: "Login is required" }, { status: 400 })
  }

  await addTeamMember(teamId, normalizedLogin)
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  const { teamId } = await params
  const team = await getTeamById(teamId)
  if (!team || team.orgId !== session!.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { login?: unknown }
  try {
    body = (await req.json()) as { login?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawLogin = typeof body.login === "string" ? body.login.trim() : ""
  const normalizedLogin = rawLogin.toLowerCase()
  if (!normalizedLogin) {
    return NextResponse.json({ error: "Login is required" }, { status: 400 })
  }

  await removeTeamMember(teamId, normalizedLogin)
  return NextResponse.json({ ok: true })
}
