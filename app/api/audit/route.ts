/**
 * GET /api/audit — Org-scoped audit event list.
 * Requires session and active org. Cursor pagination.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  listAuditEvents,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeAuditCursor,
} from "@/lib/db/auditList"

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { searchParams } = new URL(req.url)
  const limitParam = searchParams.get("limit")
  const rawLimit = limitParam != null ? parseInt(limitParam, 10) : DEFAULT_LIMIT
  const limit = Number.isNaN(rawLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

  const cursor = searchParams.get("cursor")?.trim() ?? null
  if (cursor !== null && cursor !== "") {
    const decoded = decodeAuditCursor(cursor)
    if (decoded == null) {
      return NextResponse.json({ error: "Invalid or malformed cursor" }, { status: 400 })
    }
  }

  const result = await listAuditEvents({
    orgId: session.orgId,
    limit,
    cursor: cursor || null,
  })

  if (result == null) {
    return NextResponse.json(
      { error: "Database not configured or unavailable" },
      { status: 503 }
    )
  }

  const response: {
    events: Array<{
      id: string
      org_id: string
      actor_login: string | null
      source: string
      event_type: string
      entity_type: string
      entity_id: string
      created_at: string
      metadata: Record<string, unknown> | null
      request_id: string | null
      environment_id: string | null
      project_key: string | null
    }>
    next_cursor: string | null
  } = {
    events: result.events,
    next_cursor: result.nextCursor,
  }

  return NextResponse.json(response)
}
