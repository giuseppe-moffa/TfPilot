/**
 * POST /api/platform/orgs/[orgId]/restore — Restore an archived org.
 * Platform-admin only. 404 if org not found or non-admin.
 * Idempotent: repeated restore on already-active org returns ok.
 */

import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole } from "@/lib/auth/roles"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import { getOrgById, restoreOrg } from "@/lib/db/orgs"

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

  const restoreResult = await restoreOrg(orgId)
  if (!restoreResult.ok) {
    return NextResponse.json({ error: "Failed to restore org" }, { status: 500 })
  }

  const { session } = result
  await writeAuditEvent(auditWriteDeps, {
    org_id: orgId,
    actor_login: session.login,
    source: "user",
    event_type: "org_restored",
    entity_type: "org",
    entity_id: orgId,
    metadata: { slug: org.slug, name: org.name },
  })

  return NextResponse.json({ ok: true, archivedAt: null })
}
