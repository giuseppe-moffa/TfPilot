/**
 * List request IDs from Postgres index for GET /api/requests.
 * Order by last_activity_at DESC (fallback updated_at), request_id DESC. No fallback; returns null when DB not configured.
 */

import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 200

export type RequestIndexRow = {
  request_id: string
  updated_at: string
  last_activity_at: string | null
  doc_hash: string | null
}

export type CursorPayload = { sort_key: string; request_id: string }

const SORT_EXPR = "COALESCE(last_activity_at, updated_at)"

const SELECT_PAGE_SQL = `
  SELECT request_id, updated_at, last_activity_at, doc_hash
  FROM requests_index
  ORDER BY ${SORT_EXPR} DESC, request_id DESC
  LIMIT $1
`

const SELECT_PAGE_WITH_CURSOR_SQL = `
  SELECT request_id, updated_at, last_activity_at, doc_hash
  FROM requests_index
  WHERE (${SORT_EXPR}, request_id) < ($2::timestamptz, $3::text)
  ORDER BY ${SORT_EXPR} DESC, request_id DESC
  LIMIT $1
`

/**
 * Encode cursor for pagination. Uses URL-safe base64 (base64url): - and _ instead of + and /, no padding.
 * Safe to use in query params; plain base64 would break in URLs.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ sort_key: payload.sort_key, request_id: payload.request_id })
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
    const p = parsed as CursorPayload
    if (
      parsed != null &&
      typeof parsed === "object" &&
      typeof p.request_id === "string" &&
      (typeof p.sort_key === "string" || typeof (parsed as { updated_at?: string }).updated_at === "string")
    ) {
      return {
        sort_key: p.sort_key ?? (parsed as { updated_at: string }).updated_at,
        request_id: p.request_id,
      }
    }
  } catch {
    // invalid base64url or JSON
  }
  return null
}

export type ListPageOptions = { limit: number; cursor: string | null }

/**
 * Returns a page of index rows in stable order
 * (last_activity_at DESC, fallback updated_at, request_id DESC). cursor is base64url-encoded { sort_key, request_id }.
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
    decoded.sort_key,
    decoded.request_id,
  ])
  if (result == null) return null
  return result.rows
}

/** Row shape for environment activity builder. Includes created_at, module_key, pr_number. */
export type RequestIndexRowForActivity = {
  request_id: string
  created_at: string
  updated_at: string
  module_key: string | null
  pr_number: number | null
}

const SORT_FOR_ACTIVITY = "COALESCE(last_activity_at, updated_at)"

const SELECT_BY_ENV_SQL = `
  SELECT request_id, created_at, updated_at, module_key, pr_number
  FROM requests_index
  WHERE repo_full_name = $1 AND environment_key = $2 AND environment_slug = $3
  ORDER BY ${SORT_FOR_ACTIVITY} DESC, request_id DESC
  LIMIT $4
`

/**
 * List request index rows for an environment, filtered by (repo, environment_key, environment_slug).
 * Returns null when DB not configured.
 */
export async function listRequestIndexRowsByEnvironment(
  repoFullName: string,
  environmentKey: string,
  environmentSlug: string,
  limit: number
): Promise<RequestIndexRowForActivity[] | null> {
  if (!isDatabaseConfigured()) return null
  const result = await query<RequestIndexRowForActivity>(SELECT_BY_ENV_SQL, [
    repoFullName,
    environmentKey,
    environmentSlug,
    limit,
  ])
  if (result == null) return null
  return result.rows
}
