/**
 * POST /api/auth/switch-org — Switch active org in session.
 * Body: { orgId }. Verifies user is member; updates session with new orgId/orgSlug.
 * orgSlug comes from DB only, never from client.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies, setSession } from "@/lib/auth/session"
import { getUserOrg, isOrgArchived } from "@/lib/db/orgs"

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { orgId?: unknown }
  try {
    body = (await req.json()) as { orgId?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : ""
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  }

  const org = await getUserOrg(session.login, orgId)
  if (!org) {
    return NextResponse.json({ error: "Not a member of this org" }, { status: 400 })
  }

  if (await isOrgArchived(orgId)) {
    return NextResponse.json({ error: "Cannot switch to archived org" }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true })
  setSession(res, {
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    email: session.email,
    accessToken: session.accessToken,
    orgId: org.orgId,
    orgSlug: org.orgSlug,
  })
  return res
}
