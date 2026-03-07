/**
 * POST /api/org/teams/[teamId]/members — Add member to team (org-admin only).
 * DELETE /api/org/teams/[teamId]/members — Remove member from team (org-admin only).
 * Requires session.orgId. Verifies team belongs to org.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getUserOrgRole, type OrgRole } from "@/lib/auth/orgRoles"
import {
  getTeamById,
  addTeamMember,
  removeTeamMember,
} from "@/lib/db/teams"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"

export type MembersRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload | null) => Promise<NextResponse | null>
  getUserOrgRole: (login: string, orgId: string) => Promise<OrgRole | null>
  getTeamById: (teamId: string) => Promise<{ id: string; orgId: string; slug: string } | null>
  addTeamMember: (teamId: string, login: string) => Promise<boolean>
  removeTeamMember: (teamId: string, login: string) => Promise<boolean>
  writeAuditEvent: (deps: unknown, input: unknown) => Promise<unknown>
}

const membersRouteRealDeps: MembersRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getUserOrgRole,
  getTeamById,
  addTeamMember,
  removeTeamMember,
  writeAuditEvent: (_, input) => writeAuditEvent(auditWriteDeps, input as Parameters<typeof writeAuditEvent>[1]),
}

async function requireOrgAdmin(deps: MembersRouteDeps) {
  const session = await deps.getSessionFromCookies()
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  if (!session.orgId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  const archivedRes = await deps.requireActiveOrg(session)
  if (archivedRes) return { error: archivedRes }
  const role = await deps.getUserOrgRole(session.login, session.orgId)
  if (role !== "admin") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { session }
}

export function makeMembersPOST(deps: MembersRouteDeps) {
  return async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ teamId: string }> }
  ) {
    const result = await requireOrgAdmin(deps)
    if (result.error) return result.error
    const { session } = result

    const { teamId } = await params
    const team = await deps.getTeamById(teamId)
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

    const inserted = await deps.addTeamMember(teamId, normalizedLogin)
    if (inserted) {
      deps.writeAuditEvent(null, {
        org_id: session!.orgId!,
        actor_login: session!.login,
        source: "user",
        event_type: "team_member_added",
        entity_type: "team",
        entity_id: teamId,
        metadata: { login: normalizedLogin, team_slug: team.slug },
      }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }
}

export function makeMembersDELETE(deps: MembersRouteDeps) {
  return async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ teamId: string }> }
  ) {
    const result = await requireOrgAdmin(deps)
    if (result.error) return result.error
    const { session } = result

    const { teamId } = await params
    const team = await deps.getTeamById(teamId)
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

    const removed = await deps.removeTeamMember(teamId, normalizedLogin)
    if (removed) {
      deps.writeAuditEvent(null, {
        org_id: session!.orgId!,
        actor_login: session!.login,
        source: "user",
        event_type: "team_member_removed",
        entity_type: "team",
        entity_id: teamId,
        metadata: { login: normalizedLogin, team_slug: team.slug },
      }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ teamId: string }> }
) {
  return makeMembersPOST(membersRouteRealDeps)(req, ctx)
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ teamId: string }> }
) {
  return makeMembersDELETE(membersRouteRealDeps)(req, ctx)
}
