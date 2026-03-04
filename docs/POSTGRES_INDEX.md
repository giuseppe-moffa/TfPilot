# Postgres indexing layer

Postgres holds a **projection** of request metadata for list and pagination only. It is **not** the source of truth for lifecycle or status. S3 request documents are authoritative.

**References:** Schema: `migrations/20260301000000_requests_index.sql`, `migrations/20260304100000_requests_index_environment_slug.sql`, `migrations/20260302000000_requests_index_pagination_idx.sql`, `migrations/20260302110000_drop_last_action_at.sql`, `migrations/20260302120000_requests_index_last_activity_sort_idx.sql`. Indexer: `lib/db/indexer.ts`. List: `lib/db/requestsList.ts`. UI: `app/requests/page.tsx`.

---

## Table: `requests_index`

| Column | Type | Description |
|--------|------|-------------|
| `request_id` | TEXT PK | Request ID (matches S3 key `requests/<id>.json`). |
| `created_at` | TIMESTAMPTZ | From request `receivedAt` / `createdAt` / `updatedAt`. |
| `updated_at` | TIMESTAMPTZ | From request `updatedAt`; fallback for ordering when `last_activity_at` is null. |
| `repo_full_name` | TEXT | `targetOwner/targetRepo`. |
| `environment_key` | TEXT | Environment (e.g. dev, prod). |
| `environment_slug` | TEXT | Environment slug (e.g. ai-agent). Enables precise filtering by (repo, key, slug). |
| `module_key` | TEXT | Module name. |
| `actor` | TEXT | Creator (or from config tags). |
| `pr_number` | INTEGER | PR number if present. |
| `merged_sha` | TEXT | Merge commit SHA if merged. |
| `last_activity_at` | TIMESTAMPTZ | Set only for Create, Update, Apply, Destroy, Approval (from `lastActionAt` on doc). Used for "Last updated" display. Not overwritten by sync. |
| `doc_hash` | TEXT | SHA-256 hex of deterministic request doc (see below). |

**No lifecycle or status column.** Status is always derived in the app from the S3 document.

---

## Ordering and pagination

- List order: `ORDER BY COALESCE(last_activity_at, updated_at) DESC, request_id DESC` (stable tie-break). Uses `last_activity_at` when set (user actions); falls back to `updated_at` otherwise.
- Index: `requests_index_last_activity_sort_idx` on `((COALESCE(last_activity_at, updated_at)) DESC, request_id DESC)` for cursor pagination.
- Cursor: base64url-encoded JSON `{ "sort_key": "<iso>", "request_id": "<id>" }`; next page uses `WHERE (COALESCE(last_activity_at, updated_at), request_id) < (cursor.sort_key, cursor.request_id)`.
- **UI:** Requests page (`app/requests/page.tsx`) uses cursor pagination: initial `limit=10`, then “load more” on Next when at last page. Page numbers and Previous/Next navigate over accumulated results. See [API.md](API.md) for full UI pagination description.

---

## `doc_hash` and determinism

- **Definition:** `doc_hash` is the SHA-256 hex of a **stable JSON serialization** of the full request document (sorted keys at every level, undefined omitted, dates as ISO strings). Same logical doc → same hash.
- **Implementation:** `lib/db/indexer.ts`: `computeDocHash(request)` and `stableStringify`. Used for drift detection: when the list endpoint fetches the S3 doc for a row, it recomputes the hash; if it differs from the row’s `doc_hash`, the index is stale (drift).
- **Drift:** The API returns `index_drift: true`, `index_doc_hash`, and `s3_doc_hash` on the request object so the UI or operators can see mismatch. Fix by rebuilding the index (e.g. `npm run db:rebuild-index`).

---

## Write-through indexing boundary

- **When:** After every successful S3 write of a request document, the app upserts into `requests_index`.
- **Where:** `lib/storage/requestsStore.ts`: `saveRequest()` calls `putRequest()` then `upsertRequestIndex(payload)`. Same projection is used in `scripts/rebuild-requests-index.ts`.
- **Failure policy:** Index upsert failures are **not** thrown; they are logged. S3 remains authoritative; the index can be repaired later with `npm run db:rebuild-index` (and optionally `--prune`).

---

## Drift detection and missing S3 doc (list)

- **Drift:** For each row returned by the list, the API fetches the S3 document. It computes `s3_doc_hash = computeDocHash(doc)` and compares to the row’s `doc_hash`. If they differ, the response includes on that request: `index_drift: true`, `index_doc_hash`, `s3_doc_hash`.
- **Missing S3 doc:** If the S3 get returns NoSuchKey (document missing), the request is **omitted** from the list and an entry is added to **`list_errors`**: `{ request_id, error: "NoSuchKey", index_updated_at }`. This indicates an orphan index row (index has a row but S3 object is gone). Operators can run rebuild with `--prune` to remove such rows.

---

## Activity filtering (environment_slug)

Environment activity (`GET /api/environments/:id/activity`) queries `listRequestIndexRowsByEnvironment` in **lib/db/requestsList.ts**. **Filtering must use all three:** `repo_full_name`, `environment_key`, `environment_slug`. This ensures activity timelines include only requests belonging to the exact environment, not other environments sharing the same key.

**Migration:** `20260304100000_requests_index_environment_slug.sql` adds the `environment_slug` column. Until applied, the column does not exist and activity queries would fail.

**Post-deploy steps (after adding environment_slug):**

1. `npm run db:migrate` — apply migration (adds column).
2. `npm run db:rebuild-index` — backfill `environment_slug` from S3 documents for existing rows. Rows with `environment_slug IS NULL` will not match activity queries.

---

## Rebuild and prune

- **Rebuild:** `npm run db:rebuild-index` — lists all request IDs from S3, fetches each document, and upserts into `requests_index` using the same projection as the write-through path.
- **Prune:** `npm run db:rebuild-index -- --prune` — after rebuild, deletes from `requests_index` any row whose `request_id` is not in the S3 list. Removes orphans (e.g. after S3 deletes or partial failures).

See [OPERATIONS.md](OPERATIONS.md) for runbook and failure scenarios.
