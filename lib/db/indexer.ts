/**
 * Deterministic write-through index: project request document to requests_index.
 * Only projection fields; no lifecycle status, run state, or attempt data.
 * S3 remains authoritative; index write failures must not block lifecycle.
 */

import { createHash } from "node:crypto"
import { isDatabaseConfigured } from "./config"
import { query } from "./pg"

const CREATED_BY_TAG = "tfpilot:created_by"

/** Request document shape for projection. Only fields needed for index. */
export type RequestDocForIndex = {
  id: string
  receivedAt?: string
  createdAt?: string
  updatedAt?: string
  lastActionAt?: string
  targetOwner?: string
  targetRepo?: string
  environment?: string
  module?: string
  actor?: string
  config?: { tags?: Record<string, unknown> }
  pr?: { number?: number }
  mergedSha?: string
  [key: string]: unknown
}

/**
 * Stable JSON stringify for deterministic doc_hash: sorted keys at every level,
 * undefined omitted, Date normalized to ISO string. Same logical doc → same hash.
 */
function stableStringify(obj: unknown): string {
  if (obj === null) return "null"
  if (obj === undefined) return "null"
  if (typeof obj !== "object") return JSON.stringify(obj)
  if (obj instanceof Date) return JSON.stringify(obj.toISOString())
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]"
  const keys = Object.keys(obj as object).sort()
  const pairs: string[] = []
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k]
    if (v === undefined) continue
    pairs.push(JSON.stringify(k) + ":" + stableStringify(v))
  }
  return "{" + pairs.join(",") + "}"
}

/** SHA-256 hex of stable-serialized request. Same input → same hash. Exported for drift detection and rebuild. */
export function computeDocHash(request: RequestDocForIndex): string {
  const str = stableStringify(request)
  return createHash("sha256").update(str, "utf8").digest("hex")
}

/** Project request doc to the 11 values for requests_index upsert. Exported for rebuild script. */
export function projectRequestToIndexValues(request: RequestDocForIndex): unknown[] {
  const requestId = request.id
  const createdAt = request.receivedAt ?? request.createdAt ?? request.updatedAt ?? new Date().toISOString()
  const updatedAt = request.updatedAt ?? request.receivedAt ?? new Date().toISOString()
  const repoFullName =
    request.targetOwner && request.targetRepo
      ? `${request.targetOwner}/${request.targetRepo}`
      : request.targetRepo ?? null
  const environmentKey = request.environment ?? null
  const moduleKey = request.module ?? null
  const actor =
    request.actor ??
    (typeof request.config?.tags?.[CREATED_BY_TAG] === "string"
      ? (request.config.tags[CREATED_BY_TAG] as string)
      : null)
  const prNumber = request.pr?.number ?? null
  const mergedSha = request.mergedSha ?? null
  const lastActivityAt = request.lastActionAt ?? null
  const hash = computeDocHash(request)
  return [
    requestId,
    createdAt,
    updatedAt,
    repoFullName,
    environmentKey,
    moduleKey,
    actor,
    prNumber,
    mergedSha,
    lastActivityAt,
    hash,
  ]
}

export const INDEX_UPSERT_SQL = `
INSERT INTO requests_index (
  request_id, created_at, updated_at, repo_full_name, environment_key, module_key,
  actor, pr_number, merged_sha, last_activity_at, doc_hash
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (request_id) DO UPDATE SET
  updated_at = EXCLUDED.updated_at,
  repo_full_name = EXCLUDED.repo_full_name,
  environment_key = EXCLUDED.environment_key,
  module_key = EXCLUDED.module_key,
  actor = EXCLUDED.actor,
  pr_number = EXCLUDED.pr_number,
  merged_sha = EXCLUDED.merged_sha,
  last_activity_at = COALESCE(EXCLUDED.last_activity_at, requests_index.last_activity_at),
  doc_hash = EXCLUDED.doc_hash
`

let loggedDisabled = false

/**
 * Upsert the request into requests_index. Projection only; no status, runs, or lock.
 * No-op if DB not configured. Never throws; log errors only.
 */
export async function upsertRequestIndex(request: RequestDocForIndex): Promise<void> {
  if (!isDatabaseConfigured()) {
    if (!loggedDisabled && process.env.NODE_ENV !== "production") {
      loggedDisabled = true
      console.debug("[db] indexer skipped (database not configured)")
    }
    return
  }

  const values = projectRequestToIndexValues(request)

  try {
    const result = await query(INDEX_UPSERT_SQL, values)
    if (result != null && process.env.NODE_ENV !== "production") {
      console.debug("[db] index upsert ok", { requestId: request.id })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn("[db] index upsert failed (S3 remains authoritative)", { requestId: request.id, error: message })
    // Do not throw; lifecycle must not depend on index.
  }
}
