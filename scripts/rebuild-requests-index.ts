#!/usr/bin/env tsx
/**
 * Rebuild requests_index from S3 request documents. Deterministic: same projection as write-through.
 * Usage: npm run db:rebuild-index [-- --prune]
 * --prune: delete index rows whose request_id no longer exists in S3.
 */
import "./load-env"

import { env } from "@/lib/config/env"
import { isDatabaseConfigured } from "@/lib/db/config"
import { query } from "@/lib/db/pg"
import { projectRequestToIndexValues, INDEX_UPSERT_SQL } from "@/lib/db/indexer"
import { listAllRequestIds, getRequest } from "@/lib/storage/requestsStore"

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("Database not configured. Set DATABASE_URL or PG* env.")
    process.exit(1)
  }
  if (env.TFPILOT_REQUESTS_BUCKET.startsWith("__BUILD_PLACEHOLDER_")) {
    console.error(
      "TFPILOT_REQUESTS_BUCKET is not set. Add it to .env.local (e.g. TFPILOT_REQUESTS_BUCKET=tfpilot-requests). " +
        "Optionally set TFPILOT_DEFAULT_REGION (default: eu-west-2)."
    )
    process.exit(1)
  }

  const prune = process.argv.includes("--prune")
  const ids = await listAllRequestIds()
  const totalS3Docs = ids.length

  let upserted = 0
  let failed = 0

  for (const id of ids) {
    try {
      const doc = await getRequest(id)
      const values = projectRequestToIndexValues(doc as Parameters<typeof projectRequestToIndexValues>[0])
      const result = await query(INDEX_UPSERT_SQL, values)
      if (result != null) upserted++
      else failed++
    } catch (err) {
      failed++
      console.warn("[rebuild] failed", id, (err as Error)?.message ?? err)
    }
  }

  let pruned = 0
  if (prune && ids.length > 0) {
    const keepIds = ids
    const r = await query<{ request_id: string }>("SELECT request_id FROM requests_index")
    if (r != null) {
      const toDelete = r.rows.filter((row) => !keepIds.includes(row.request_id)).map((row) => row.request_id)
      if (toDelete.length > 0) {
        const res = await query(
          "DELETE FROM requests_index WHERE request_id = ANY($1::text[])",
          [toDelete]
        )
        pruned = res?.rowCount ?? toDelete.length
      }
    }
  }

  console.log(
    JSON.stringify({
      total_s3_docs: totalS3Docs,
      upserted,
      failed,
      ...(prune ? { pruned } : {}),
    })
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
