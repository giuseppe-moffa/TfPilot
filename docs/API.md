# API reference (key endpoints)

Concise contract for endpoints that affect or expose the Postgres index, list, and health. For full route list and behavior, see the code under `app/api/`.

---

## GET /api/requests

Returns a paginated list of requests. **Requires Postgres.** If the database is not configured or unreachable, the response is **503** with a JSON body.

### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Page size (1–200). Default 50. |
| `cursor` | string | Opaque cursor from previous page’s `next_cursor`. Omit for first page. |

Invalid or malformed `cursor` → **400** `{ success: false, error: "Invalid or malformed cursor" }`.

### Response (200)

```json
{
  "success": true,
  "requests": [ /* array of request objects */ ],
  "next_cursor": "<base64url string or null>",
  "list_errors": [ /* array, see below */ ]
}
```

- **requests:** Each element is the full request document (from S3) with derived `status` and optional drift fields. May include:
  - `index_projection_updated_at` — `updated_at` from the index row.
  - `index_projection_last_activity_at` — `last_activity_at` from the index (for “Last updated” display); falls back to `updated_at` when null.
  - If index and S3 doc hash differ: `index_drift: true`, `index_doc_hash`, `s3_doc_hash`.
- **next_cursor:** Base64url-encoded JSON: `{ "sort_key": "<iso>", "request_id": "<id>" }`. Use as `?cursor=<next_cursor>` for the next page. `null` when there is no next page. (Legacy cursors with `updated_at` instead of `sort_key` are still accepted.)
- **list_errors:** Array of `{ request_id, error, index_updated_at }`. Entries are added when the index row exists but the S3 document is missing (e.g. `error: "NoSuchKey"`). Those requests are not included in `requests`.

### Cursor pagination semantics

- Ordering: `COALESCE(last_activity_at, updated_at) DESC`, then `request_id DESC` (stable). Uses `last_activity_at` when set (Create, Update, Apply, Destroy, Approval); falls back to `updated_at` otherwise.
- Cursor represents the last item of the current page; the next page returns rows strictly before that (smaller `sort_key` or same `sort_key` and smaller `request_id`).
- **UI pagination (Requests page):** Initial load fetches first page (`limit=10`). Next/Previous and page numbers (1, 2, 3…) navigate client-side over accumulated results. Clicking Next on the last visible page triggers “load more” via `next_cursor`. “Showing X to Y of Z entries” reflects loaded-and-filtered count. Each page is a snapshot; no global consistency guarantee across fetches.

### When list requires DB (503)

- If `DATABASE_URL` (or `PG*`) is not set: **503** `{ success: false, error: "Database not configured; list requires Postgres" }`.
- If the DB is unreachable (e.g. connection error): **503** `{ success: false, error: "Database unreachable: ..." }`.

No fallback: the list endpoint does not serve from S3-only when Postgres is missing.

---

## GET /api/health/db

Checks Postgres connectivity. **DB-optional:** when the database is not configured, the API still returns a response (503).

### Response

- **Configured and reachable:** 200 `{ ok: true }`.
- **Not configured:** 503 `{ ok: false, error: "Database not configured (set DATABASE_URL or PG* env)" }`.
- **Configured but unreachable:** 503 `{ ok: false, error: "<message>" }` (e.g. connection or query failure).

Implementation: `app/api/health/db/route.ts` — uses `isDatabaseConfigured()` from `lib/db/config.ts` and runs `SELECT 1`.

---

## Workspaces

Use **GET/POST /api/workspaces** and project-scoped workspace URLs (e.g. `/projects/[projectId]/workspaces`). Request create accepts `workspace_id` or `(project_key, workspace_key, workspace_slug)`.

### GET /api/workspace-templates

Returns workspace template index from S3 (`templates/workspaces/index.json`). **Requires session.** Response: array of `{ id, name, latest_version, description?, category?, icon?, recommended? }`. Used by create-workspace UI. **503** when index not seeded.

---

## Projects and workspaces

### GET /api/projects

List projects for the active org. **Requires session.** Response: `{ projects: [{ id, project_key, name, workspace_count }] }`. **503** when DB not configured.

### POST /api/projects

Create project. **Requires session.** Body: `name`, `project_key`, `repo_full_name`, `default_branch`. Validates: project_key lowercase alphanumeric + hyphens; repo_full_name owner/repo format. Creator auto-assigned as project admin. **409** when project_key already exists in org. **201** returns created project.

### GET /api/projects/[projectId]

Fetch single project. **Requires session.** Accepts `project_key` or project id in URL. Response: `{ project: { id, project_key, name, repo_full_name, default_branch, ... }, workspace_count }`. **404** when not found.

### PATCH /api/projects/[projectId]

Update project metadata. **Requires session** and `manage_access` on project. Body: `name`, `repo_full_name`, `default_branch` (all optional, partial update). **403** when permission denied. **404** when not found.

### GET /api/workspaces

List workspaces. **Requires session.** Query: `project_key`, `include_archived` (default false). Response: `{ workspaces: [...] }`. **503** when DB not configured.

### POST /api/workspaces

Create workspace + bootstrap PR. **Requires session** and GitHub connected. Body: `project_key`, `workspace_key`, `workspace_slug`, `template_id` (optional). Reads `repo_full_name` and `default_branch` from **projects table** only. **404** when project not found. **400** when project missing repo config. **409** when workspace already exists. **201** returns workspace + bootstrap info.

### Admin audit: workspaces missing project

**GET /api/admin/audit/workspaces-missing-project** — Platform-admin only. Lists `(org_id, project_key)` pairs from workspaces that have no matching project row. Optional `?org_id=` filter. Response: `{ orphaned: [{ org_id, project_key }], count }`. Read-only; no auto-fix.

---

## Auth and org switching

### GET /api/auth/orgs

Returns org memberships for the current user. **Requires session.** Archived orgs are excluded (for org switcher).

**Response (200):** `{ orgs: [{ orgId, orgSlug, orgName }] }`.

### POST /api/auth/switch-org

Switch active org in session. **Requires session.** Body: `{ orgId }`. Verifies user is member; rejects archived org (400). Updates session with orgId/orgSlug from DB only.

**Response (200):** `{ ok: true }`. **400** when orgId missing, not a member, or org is archived.

---

## Platform orgs (platform-admin only)

Platform-admin = `isPlatformAdmin(login)` (platform_admins table). Non-admins receive **404** (same as org-not-found).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/platform/orgs` | GET | List orgs with member counts. Query: `?filter=active` (default) \| `archived` \| `all`. |
| `POST /api/platform/orgs` | POST | Create org. Body: `slug`, `name`, `adminLogin`. Creates org + initial admin atomically. 400 for duplicate slug, missing fields. |
| `GET /api/platform/orgs/[orgId]` | GET | Org detail: org, members, teams, stats. 404 when org not found. |
| `POST /api/platform/orgs/[orgId]/archive` | POST | Soft-archive org (sets `archived_at`). Idempotent. |
| `POST /api/platform/orgs/[orgId]/restore` | POST | Restore archived org (clears `archived_at`). Idempotent. |

**Archived org enforcement:** Org-scoped APIs (requests, workspaces, metrics/insights, etc.) return **403** `{ error: "Organization archived" }` when `session.orgId` points to an archived org. Platform routes bypass this; platform admins can list/view/archive/restore orgs even when current org is archived.

---

## Other endpoints

- **GET /api/requests/[requestId]** — Single request from S3; no Postgres required for this route.
- **GET /api/health** — General app health (no DB check).
- Sync, approve, merge, apply, destroy, etc. — See code and [OPERATIONS.md](OPERATIONS.md) / [REQUEST_LIFECYCLE.md](REQUEST_LIFECYCLE.md).
