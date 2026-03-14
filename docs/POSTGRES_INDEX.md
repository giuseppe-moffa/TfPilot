# Postgres indexing layer

Postgres holds a **projection** of request metadata for list and pagination only. It is **not** the source of truth for lifecycle or status. S3 request documents are authoritative.

**Schema:** One baseline migration `migrations/20260301000000_baseline.sql` defines the canonical schema: `orgs`, `org_memberships`, `projects`, `teams`, `workspaces` (with `template_id`/`template_version` NOT NULL, `template_inputs` JSONB), `requests_index` (with `workspace_key`/`workspace_slug`, `org_id`), `audit_events` (with `workspace_id`), `platform_admins`. Old incremental migrations are archived under `migrations/archive/`.

**References:** Schema: single baseline migration `migrations/20260301000000_baseline.sql`. Indexer: `lib/db/indexer.ts`. List: `lib/db/requestsList.ts`. UI: `app/requests/page.tsx`.

**Org tenancy tables** (separate from requests_index): `orgs`, `org_memberships`, `teams`, `team_memberships`, `project_team_access`, `projects`. See [ORGANISATIONS.md](ORGANISATIONS.md) and [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

---

## Org and project tables (authoritative)

Postgres also holds authoritative data for org tenancy and project access. See [ORGANISATIONS.md](ORGANISATIONS.md) and [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

| Table | Purpose |
|-------|---------|
| **orgs** | `id`, `slug`, `name`, `created_at`, `updated_at`, `archived_at` (NULL = active) |
| **org_memberships** | `org_id`, `login`, `role` (viewer, developer, approver, admin) |
| **teams** | `id`, `org_id`, `slug`, `name` |
| **team_memberships** | `team_id`, `login` |
| **project_team_access** | `project_id`, `team_id` |
| **projects** | `id`, `org_id`, `project_key`, `name`, `repo_full_name`, `default_branch` |

Migrations: `20260320000000_orgs.sql`, `20260320001000_projects.sql`, `20260320004000_teams.sql`, `20260320005000_orgs_archived_at.sql`.

---

## Table: `requests_index`

| Column | Type | Description |
|--------|------|-------------|
| `request_id` | TEXT PK | Request ID (matches S3 key `requests/<id>.json`). |
| `org_id` | TEXT NOT NULL | Org ownership; required for tenancy. |
| `created_at` | TIMESTAMPTZ | From request `receivedAt` / `createdAt` / `updatedAt`. |
| `updated_at` | TIMESTAMPTZ | From request `updatedAt`; fallback for ordering when `last_activity_at` is null. |
| `repo_full_name` | TEXT | `targetOwner/targetRepo`. |
| `workspace_key` | TEXT | Workspace key (e.g. dev, prod). |
| `workspace_slug` | TEXT | Workspace slug (e.g. ai-agent). Enables precise filtering by (repo, key, slug). |
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

## Projection discipline

The `requests_index` table is the baseline example of TfPilot projection discipline: derived from S3 request documents; rebuildable; non-authoritative for lifecycle; optimized for list/pagination only. Future derived stores (e.g. workspace_runs, change_sets, workspace-level analytics or intelligence views) should follow the same rule: derived, rebuildable, non-authoritative.

---

## Drift detection and missing S3 doc (list)

- **Drift:** For each row returned by the list, the API fetches the S3 document. It computes `s3_doc_hash = computeDocHash(doc)` and compares to the row’s `doc_hash`. If they differ, the response includes on that request: `index_drift: true`, `index_doc_hash`, `s3_doc_hash`.
- **Missing S3 doc:** If the S3 get returns NoSuchKey (document missing), the request is **omitted** from the list and an entry is added to **`list_errors`**: `{ request_id, error: "NoSuchKey", index_updated_at }`. This indicates an orphan index row (index has a row but S3 object is gone). Operators can run rebuild with `--prune` to remove such rows.

---

## Activity filtering (workspace)

Workspace activity (`GET /api/workspaces/:id/activity`) queries `listRequestIndexRowsByWorkspace` in **lib/db/requestsList.ts**. **Filtering must use all three:** `repo_full_name`, `workspace_key`, `workspace_slug`. This ensures activity timelines include only requests belonging to the exact workspace.

---

## Local bootstrap (clean baseline)

To get a clean schema from scratch:

1. **Reset** (drops all app tables and schema_migrations): `npm run db:reset`
2. **Apply baseline:** `npm run db:migrate`
3. **Seed** (optional): `npm run db:seed`, `npm run db:seed-platform-admins`, and seed workspace templates via `POST /api/workspace-templates/admin/seed` if needed.

---

## Rebuild and prune

- **Rebuild:** `npm run db:rebuild-index` — lists all request IDs from S3, fetches each document, and upserts into `requests_index` using the same projection as the write-through path.
- **Prune:** `npm run db:rebuild-index -- --prune` — after rebuild, deletes from `requests_index` any row whose `request_id` is not in the S3 list. Removes orphans (e.g. after S3 deletes or partial failures).

See [OPERATIONS.md](OPERATIONS.md) for runbook and failure scenarios.
