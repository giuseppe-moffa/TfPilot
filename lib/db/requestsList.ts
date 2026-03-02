/**
 * List request IDs from Postgres index for GET /api/requests.
 * Order by updated_at DESC, request_id DESC. No fallback; returns null when DB not configured.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 200

export type RequestIndexRow = { request_id: string; updated_at: string; doc_hash: string | null }

export type CursorPayload = { updated_at: string; request_id: string }

const SELECT_PAGE_SQL = `
  SELECT request_id, updated_at, doc_hash
  FROM requests_index
  ORDER BY updated_at DESC, request_id DESC
  LIMIT $1
`

const SELECT_PAGE_WITH_CURSOR_SQL = `
  SELECT request_id, updated_at, doc_hash
  FROM requests_index
  WHERE (updated_at, request_id) < ($2::timestamptz, $3::text)
  ORDER BY updated_at DESC, request_id DESC
  LIMIT $1
`

/**
 * Encode cursor for pagination. Uses URL-safe base64 (base64url): - and _ instead of + and /, no padding.
 * Safe to use in query params; plain base64 would break in URLs.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ updated_at: payload.updated_at, request_id: payload.request_id })
  const buf = Buffer.from(json, "utf8")
  try {
    return buf.toString("base64url")
  } catch {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
}

/**
 * Decode cursor. Returns null if invalid (caller should return 400).
 * Accepts base64url (URL-safe) encoding.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  if (typeof cursor !== "string" || !cursor.trim()) return null
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4
    const padded = pad === 0 ? b64 : b64 + "==".slice(0, 4 - pad)
    const json = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(json) as unknown
    if (
      parsed != null &&
      typeof parsed === "object" &&
      typeof (parsed as CursorPayload).updated_at === "string" &&
      typeof (parsed as CursorPayload).request_id === "string"
    ) {
      return { updated_at: (parsed as CursorPayload).updated_at, request_id: (parsed as CursorPayload).request_id }
    }
  } catch {
    // invalid base64url or JSON
  }
  return null
}

export type ListPageOptions = { limit: number; cursor: string | null }

/**
 * Returns a page of index rows (request_id, updated_at, doc_hash) in stable order
 * (updated_at DESC, request_id DESC). cursor is base64url-encoded { updated_at, request_id }.
 * Returns null if DB not configured.
 */
export async function listRequestIndexRowsPage(options: {
  limit: number
  cursor: string | null
}): Promise<RequestIndexRow[] | null> {
  if (!isDatabaseConfigured()) return null
  const { limit, cursor } = options
  if (cursor == null || cursor === "") {
    const result = await query<RequestIndexRow>(SELECT_PAGE_SQL, [limit])
    if (result == null) return null
    return result.rows
  }
  const decoded = decodeCursor(cursor)
  if (decoded == null) return null
  const result = await query<RequestIndexRow>(SELECT_PAGE_WITH_CURSOR_SQL, [
    limit,
    decoded.updated_at,
    decoded.request_id,
  ])
  if (result == null) return null
  return result.rows
}

const SELECT_IDS_SQL = `
  SELECT request_id, updated_at, doc_hash
  FROM requests_index
  ORDER BY updated_at DESC, request_id DESC
  LIMIT $1
`

/**
 * Returns index rows (request_id + updated_at + doc_hash) in order (updated_at DESC, request_id DESC),
 * or null if DB not configured. updated_at is for display/sorting only; never use for lifecycle.
 */
export async function listRequestIdsFromIndex(
  limit = DEFAULT_LIST_LIMIT
): Promise<RequestIndexRow[] | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<RequestIndexRow>(SELECT_IDS_SQL, [limit])
  if (result == null) return null
  return result.rows
}
