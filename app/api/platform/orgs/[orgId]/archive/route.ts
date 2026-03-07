/**
 * POST /api/platform/orgs/[orgId]/archive — Soft-archive an org.
 * Platform-admin only. 404 if org not found or non-admin.
 * Idempotent: repeated archive returns ok.
 */

import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole } from "@/lib/auth/roles"
import { getOrgById, archiveOrg } from "@/lib/db/orgs"

async function requirePlatformAdmin() {
  const session = await getSessionFromCookies()
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  const role = getUserRole(session.login)
  if (role !== "admin") {
    return { error: NextResponse.json(null, { status: 404 }) }
  }
  return { session }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const result = await requirePlatformAdmin()
  if (result.error) return result.error

  const { orgId } = await params
  const org = await getOrgById(orgId)
  if (!org) {
    return NextResponse.json(null, { status: 404 })
  }

  const archiveResult = await archiveOrg(orgId)
  if (!archiveResult.ok) {
    return NextResponse.json({ error: "Failed to archive org" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, archivedAt: archiveResult.archivedAt })
}
