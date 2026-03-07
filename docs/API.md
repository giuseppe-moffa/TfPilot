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

## Environment and Environment Templates

### GET /api/environments

List environments (DB-backed). **Requires session.** Query params: `project_key`, `include_archived` (default false).

**Response (200):** `{ environments: Environment[] }`. **503** when DB not configured or unavailable.

### POST /api/environments

Create environment. **Requires session** (viewer role blocked). Body: `project_key`, `environment_key`, `environment_slug`, `template_id` (optional; validated against `config/environment-templates.ts`). Invalid `template_id` → **400** `{ error: "INVALID_ENV_TEMPLATE" }`. On success: creates DB row, optionally creates bootstrap PR; returns **201** `{ environment, bootstrap }`. **409** when environment already exists.

### GET /api/environments/:id

Fetch single environment + deploy status. **Requires session.** Uses GitHub API via `getEnvironmentDeployStatus`.

**Response (200):**
```json
{
  "environment": { /* DB row */ },
  "deployed": boolean,
  "deployPrOpen": boolean | null,
  "envRootExists": boolean | null,
  "deployPrUrl": string | null,
  "error": "ENV_DEPLOY_CHECK_FAILED" | null
}
```

- `deployed`: true when `backend.tf` exists on default branch at `envs/<key>/<slug>/`.
- `deployPrOpen`: true when open PR with head `deploy/<key>/<slug>` exists.
- `deployPrUrl`: URL when PR exists.
- `envRootExists`: env root directory exists on default branch.
- When GitHub check fails (e.g. rate limit), `error: "ENV_DEPLOY_CHECK_FAILED"`; `deployPrOpen` null; fail-closed.

### POST /api/environments/:id/deploy

Create deploy PR from environment template. **Admin-only.** Creates branch `deploy/<key>/<slug>`, commits bootstrap via `envSkeleton`, opens PR. Returns `deploy.pr_url`, `deploy.pr_number`.

**Deploy error semantics:**

| Error | HTTP | Condition |
|-------|------|-----------|
| `ENV_ALREADY_DEPLOYED` | 409 | `backend.tf` exists on default branch (env already deployed) |
| `ENV_DEPLOY_IN_PROGRESS` | 409 | Branch `deploy/<key>/<slug>` exists **or** open deploy PR exists. Branch-only and PR-open are intentionally treated the same. |
| `ENV_DEPLOY_CHECK_FAILED` | 503 | GitHub check fails (e.g. rate limit, unreachable). Fail-closed. |
| `INVALID_ENV_TEMPLATE` | 400 | Environment has invalid or unknown `template_id`. |

### GET /api/environments/:id/activity

Environment activity timeline. **Requires session.** Derived from Postgres request index + deploy status only (no S3 reads).

**Response (200):**
```json
{
  "activity": [
    {
      "type": "environment_deployed" | "environment_deploy_pr_open" | "request_created",
      "timestamp": "<ISO string>",
      "request_id": "<optional>",
      "module": "<optional>",
      "pr_url": "<optional>",
      "pr_number": "<optional>"
    }
  ],
  "warning": "ENV_DEPLOY_CHECK_FAILED"
}
```

- `activity`: Newest first. Event types: `environment_deployed`, `environment_deploy_pr_open`, `request_created`. Future types may include `plan_succeeded`, `apply_succeeded`, `destroy_succeeded`.
- `warning`: Present when GitHub deploy check fails; deploy events are omitted, request-derived events still returned.
- **404** when environment not found: `{ error: "NOT_FOUND" }`.

### GET /api/environment-templates

Returns environment templates (static config from `config/environment-templates.ts`). **Requires session.** Response: array of `{ id, label?, modules: { module, order, defaultConfig? }[] }`. Templates: `blank`, `baseline-ai-service`, `baseline-app-service`, `baseline-worker-service`.

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

Platform-admin = `getUserRole(login) === "admin"` (TFPILOT_ADMINS). Non-admins receive **404** (same as org-not-found).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/platform/orgs` | GET | List orgs with member counts. Query: `?filter=active` (default) \| `archived` \| `all`. |
| `POST /api/platform/orgs` | POST | Create org. Body: `slug`, `name`, `adminLogin`. Creates org + initial admin atomically. 400 for duplicate slug, missing fields. |
| `GET /api/platform/orgs/[orgId]` | GET | Org detail: org, members, teams, stats. 404 when org not found. |
| `POST /api/platform/orgs/[orgId]/archive` | POST | Soft-archive org (sets `archived_at`). Idempotent. |
| `POST /api/platform/orgs/[orgId]/restore` | POST | Restore archived org (clears `archived_at`). Idempotent. |

**Archived org enforcement:** Org-scoped APIs (requests, environments, metrics/insights, etc.) return **403** `{ error: "Organization archived" }` when `session.orgId` points to an archived org. Platform routes bypass this; platform admins can list/view/archive/restore orgs even when current org is archived.

---

## Other endpoints

- **GET /api/requests/[requestId]** — Single request from S3; no Postgres required for this route.
- **GET /api/health** — General app health (no DB check).
- Sync, approve, merge, apply, destroy, etc. — See code and [OPERATIONS.md](OPERATIONS.md) / [REQUEST_LIFECYCLE.md](REQUEST_LIFECYCLE.md).
