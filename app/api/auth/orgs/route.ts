/**
 * GET /api/auth/orgs — Org memberships for current login.
 * Returns orgId, orgSlug, orgName for each org the user belongs to.
 */

import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { listUserOrgs } from "@/lib/db/orgs"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgs = await listUserOrgs(session.login)
  return NextResponse.json({
    orgs: orgs.map((o) => ({ orgId: o.orgId, orgSlug: o.orgSlug, orgName: o.orgName })),
  })
}
