/**
 * GET /api/org/members — Org members for active org.
 * POST /api/org/members — Add or update member (org-admin only). Upserts by GitHub login.
 * PATCH /api/org/members — Update member role (org-admin only).
 * DELETE /api/org/members — Remove member (org-admin only).
 * Requires session.orgId. Org_id comes only from session.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import {
  getOrgById,
  listOrgMembers,
  upsertOrgMember,
  isValidOrgRole,
  getOrgMember,
  updateOrgMemberRole,
  deleteOrgMember,
  countOrgAdmins,
} from "@/lib/db/orgs"

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

  const org = await getOrgById(session!.orgId!)
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const members = await listOrgMembers(session!.orgId!)

  return NextResponse.json({
    org: { id: org.id, slug: org.slug, name: org.name },
    members: members.map((m) => ({
      login: m.login,
      role: m.role,
      joinedAt: m.created_at,
    })),
  })
}

export async function POST(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { login?: unknown; role?: unknown }
  try {
    body = (await req.json()) as { login?: unknown; role?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawLogin = typeof body.login === "string" ? body.login.trim() : ""
  const normalizedLogin = rawLogin.toLowerCase()
  if (!normalizedLogin) {
    return NextResponse.json({ error: "GitHub login is required" }, { status: 400 })
  }

  const rawRole = typeof body.role === "string" ? body.role.trim() : ""
  if (!isValidOrgRole(rawRole)) {
    return NextResponse.json(
      { error: "Invalid role; must be viewer, developer, approver, or admin" },
      { status: 400 }
    )
  }

  const member = await upsertOrgMember(session!.orgId!, normalizedLogin, rawRole)
  if (!member) {
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 })
  }

  return NextResponse.json({
    member: { login: member.login, role: member.role, joinedAt: member.created_at },
  })
}

export async function PATCH(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { login?: unknown; role?: unknown }
  try {
    body = (await req.json()) as { login?: unknown; role?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawLogin = typeof body.login === "string" ? body.login.trim() : ""
  const normalizedLogin = rawLogin.toLowerCase()
  if (!normalizedLogin) {
    return NextResponse.json({ error: "GitHub login is required" }, { status: 400 })
  }

  const rawRole = typeof body.role === "string" ? body.role.trim() : ""
  if (!isValidOrgRole(rawRole)) {
    return NextResponse.json(
      { error: "Invalid role; must be viewer, developer, approver, or admin" },
      { status: 400 }
    )
  }

  const existing = await getOrgMember(session!.orgId!, normalizedLogin)
  if (!existing) {
    return NextResponse.json({ error: "Member not found in this org" }, { status: 404 })
  }

  if (existing.role === "admin" && rawRole !== "admin") {
    const adminCount = await countOrgAdmins(session!.orgId!)
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the last org admin. Add another admin first." },
        { status: 400 }
      )
    }
  }

  const member = await updateOrgMemberRole(session!.orgId!, normalizedLogin, rawRole)
  if (!member) {
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 })
  }

  return NextResponse.json({
    member: { login: member.login, role: member.role, joinedAt: member.created_at },
  })
}

export async function DELETE(req: NextRequest) {
  const result = await requireOrgAdmin()
  if (result.error) return result.error
  const { session } = result

  let body: { login?: unknown }
  try {
    body = (await req.json()) as { login?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawLogin = typeof body.login === "string" ? body.login.trim() : ""
  const normalizedLogin = rawLogin.toLowerCase()
  if (!normalizedLogin) {
    return NextResponse.json({ error: "GitHub login is required" }, { status: 400 })
  }

  const existing = await getOrgMember(session!.orgId!, normalizedLogin)
  if (!existing) {
    return NextResponse.json({ error: "Member not found in this org" }, { status: 404 })
  }

  if (existing.role === "admin") {
    const adminCount = await countOrgAdmins(session!.orgId!)
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last org admin. Add another admin first." },
        { status: 400 }
      )
    }
  }

  const deleted = await deleteOrgMember(session!.orgId!, normalizedLogin)
  if (!deleted) {
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
