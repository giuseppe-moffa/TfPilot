/**
 * List audit events for GET /api/audit.
 * Org-scoped, ordered by created_at DESC, id DESC. Cursor pagination.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100

export type AuditEventRow = {
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
}

export type AuditCursorPayload = { created_at: string; id: string }

const SELECT_PAGE_SQL = `
  SELECT id, org_id, actor_login, source, event_type, entity_type, entity_id, created_at, metadata, request_id, environment_id, project_key
  FROM audit_events
  WHERE org_id = $1
  ORDER BY created_at DESC, id DESC
  LIMIT $2
`

const SELECT_PAGE_WITH_CURSOR_SQL = `
  SELECT id, org_id, actor_login, source, event_type, entity_type, entity_id, created_at, metadata, request_id, environment_id, project_key
  FROM audit_events
  WHERE org_id = $1 AND (created_at, id) < ($3::timestamptz, $4::text)
  ORDER BY created_at DESC, id DESC
  LIMIT $2
`

export function encodeAuditCursor(payload: AuditCursorPayload): string {
  const json = JSON.stringify({ created_at: payload.created_at, id: payload.id })
  const buf = Buffer.from(json, "utf8")
  try {
    return buf.toString("base64url")
  } catch {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
}

export function decodeAuditCursor(cursor: string): AuditCursorPayload | null {
  if (typeof cursor !== "string" || !cursor.trim()) return null
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4
    const padded = pad === 0 ? b64 : b64 + "==".slice(0, 4 - pad)
    const json = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(json) as unknown
    const p = parsed as AuditCursorPayload
    if (
      parsed != null &&
      typeof parsed === "object" &&
      typeof p.id === "string" &&
      typeof p.created_at === "string"
    ) {
      return { created_at: p.created_at, id: p.id }
    }
  } catch {
    // invalid base64url or JSON
  }
  return null
}

export type ListAuditEventsResult = {
  events: AuditEventRow[]
  nextCursor: string | null
} | null

/**
 * List audit events for an org. Returns null if DB not configured.
 * Fetches limit+1 to detect hasMore; nextCursor set when more rows exist.
 */
export async function listAuditEvents(options: {
  orgId: string
  limit: number
  cursor: string | null
}): Promise<ListAuditEventsResult> {
  if (!isDatabaseConfigured()) return null
  const { orgId, limit, cursor } = options
  const fetchLimit = limit + 1

  let result: { rows: AuditEventRow[] } | null
  if (cursor == null || cursor === "") {
    result = await query<AuditEventRow>(SELECT_PAGE_SQL, [orgId, fetchLimit])
  } else {
    const decoded = decodeAuditCursor(cursor)
    if (decoded == null) return null
    result = await query<AuditEventRow>(SELECT_PAGE_WITH_CURSOR_SQL, [
      orgId,
      fetchLimit,
      decoded.created_at,
      decoded.id,
    ])
  }

  if (result == null) return null
  const rows = result.rows
  const hasMore = rows.length > limit
  const events = hasMore ? rows.slice(0, limit) : rows
  const last = events[events.length - 1]
  const nextCursor =
    hasMore && last != null ? encodeAuditCursor({ created_at: last.created_at, id: last.id }) : null

  return { events, nextCursor }
}
