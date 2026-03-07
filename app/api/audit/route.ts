/**
 * GET /api/audit — Org-scoped audit event list.
 * Requires session and active org. Cursor pagination.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  listAuditEvents,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeAuditCursor,
  type AuditEventRow,
  type ListAuditEventsResult,
} from "@/lib/db/auditList"

export type AuditRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload | null) => Promise<NextResponse | null>
  listAuditEvents: (opts: { orgId: string; limit: number; cursor: string | null }) => Promise<ListAuditEventsResult>
  decodeAuditCursor: (cursor: string) => { created_at: string; id: string } | null
  DEFAULT_LIMIT: number
  MAX_LIMIT: number
}

const auditRouteRealDeps: AuditRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  listAuditEvents,
  decodeAuditCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
}

export function makeAuditGET(deps: AuditRouteDeps) {
  return async function GET(req: NextRequest) {
    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    if (!session.orgId) {
      return NextResponse.json({ error: "No org context" }, { status: 403 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes

    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get("limit")
    const rawLimit = limitParam != null ? parseInt(limitParam, 10) : deps.DEFAULT_LIMIT
    const limit = Number.isNaN(rawLimit)
      ? deps.DEFAULT_LIMIT
      : Math.min(Math.max(rawLimit, 1), deps.MAX_LIMIT)

    const cursor = searchParams.get("cursor")?.trim() ?? null
    if (cursor !== null && cursor !== "") {
      const decoded = deps.decodeAuditCursor(cursor)
      if (decoded == null) {
        return NextResponse.json({ error: "Invalid or malformed cursor" }, { status: 400 })
      }
    }

    const result = await deps.listAuditEvents({
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
      events: AuditEventRow[]
      next_cursor: string | null
    } = {
      events: result.events,
      next_cursor: result.nextCursor,
    }

    return NextResponse.json(response)
  }
}

export const GET = makeAuditGET(auditRouteRealDeps)
