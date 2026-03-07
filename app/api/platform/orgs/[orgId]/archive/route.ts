/**
 * POST /api/platform/orgs/[orgId]/archive — Soft-archive an org.
 * Platform-admin only. 404 if org not found or non-admin.
 * Idempotent: repeated archive returns ok.
 */

import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import { getOrgById, archiveOrg } from "@/lib/db/orgs"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error

  const { orgId } = await params
  const org = await getOrgById(orgId)
  if (!org) {
    return NextResponse.json(null, { status: 404 })
  }

  const archiveResult = await archiveOrg(orgId)
  if (!archiveResult.ok) {
    return NextResponse.json({ error: "Failed to archive org" }, { status: 500 })
  }

  const { session } = result
  await writeAuditEvent(auditWriteDeps, {
    org_id: orgId,
    actor_login: session.login,
    source: "user",
    event_type: "org_archived",
    entity_type: "org",
    entity_id: orgId,
    metadata: { slug: org.slug, name: org.name },
  })

  return NextResponse.json({ ok: true, archivedAt: archiveResult.archivedAt })
}
