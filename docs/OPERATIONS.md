# Operations

Short playbook for recovery and common operations. No application logic changes here; docs only.

---

## Platform admin org management

Platform admins (`platform_admins` table) manage orgs via `/api/platform/orgs` and `/settings/platform/orgs`:

| Task | Endpoint / Action |
|------|-------------------|
| List orgs | `GET /api/platform/orgs?filter=active` (default) \| `archived` \| `all` |
| Create org | `POST /api/platform/orgs` with `slug`, `name`, `adminLogin` |
| Org detail | `GET /api/platform/orgs/[orgId]` |
| Archive org | `POST /api/platform/orgs/[orgId]/archive` (idempotent) |
| Restore org | `POST /api/platform/orgs/[orgId]/restore` (idempotent) |

Non-platform-admin callers receive **404**. Platform routes bypass `requireActiveOrg` — accessible even when current session org is archived. See [ORGANISATIONS.md](ORGANISATIONS.md), [API.md](API.md).

---

## Workspaces (Model 2)

Workspaces are first-class entities. Each has a bootstrap PR that creates `envs/<workspace_key>/<workspace_slug>/` in the terraform repo. The `envs/` prefix is historical repository naming; each directory represents a Terraform root for a workspace.

| Task | Endpoint / Action |
|------|-------------------|
| List workspaces | `GET /api/workspaces?project_key=core` (optional filter) |
| Create workspace | `POST /api/workspaces` with `project_key`, `workspace_key`, `workspace_slug` |
| Get single workspace | `GET /api/workspaces/:id` |

**Bootstrap flow:** POST create persists the row, then opens a PR that adds:
- `envs/<key>/<slug>/backend.tf` (generic `backend "s3" {}`; key injected via workflow)
- `envs/<key>/<slug>/providers.tf`, `versions.tf`
- `envs/<key>/<slug>/tfpilot/base.tf`, `tfpilot/requests/.gitkeep`

**Idempotency:** If `backend.tf` already exists at the workspace root on the base branch, the create returns `already_bootstrapped: true` and does not open a duplicate PR.

**Failure modes:**
- **409 Conflict** — Workspace with same (project_key, workspace_key, workspace_slug) already exists. Response includes `workspace_id` of existing.
- **404** — No infra repo for project_key + workspace_key. Check `config/infra-repos.ts`.
- **503** — Database not configured or unavailable.
- **GitHub errors** — Bootstrap PR creation fails (permissions, branch protection, rate limit). Check GitHub token and repo access.

**Readiness:** Workspace is "selectable" for requests only after the bootstrap PR is merged. Do not store a status column; infer from PR merge facts or repo path existence.

---

## Workspace destroy (Phase 6)

| Task | Endpoint / Action |
|------|-------------------|
| Destroy workspace | `POST /api/workspaces/:id/destroy` |

**Flow:**
1. If pending exists: reconcile (fetch run status). In-progress/queued → 409. Completed success → archive, clear pending, return 200. Completed failure → clear pending, allow re-dispatch. Run not found + TTL expired (2h) → clear pending, allow re-dispatch.
2. Dispatches `destroy` workflow with `destroy_scope="workspace"` (no `request_id`).
3. On workflow success, webhook archives the workspace (sets `archived_at`).
4. Archived workspaces are excluded from request creation.

**Idempotency:** If already archived, returns 200 with `alreadyArchived: true`. Safe to retry.

**Refusals:**
- **404** — Workspace not found.
- **400** — Workspace already archived.
- **409** — Another workspace destroy in progress.
- **403** — Insufficient role (admin required).

**Concurrency:** The workflow uses `concurrency` per `(workspace_key, workspace_slug)`. Only one destroy runs at a time per workspace. The app refuses (409) if a pending destroy run is still in progress. Pending records include `run_id`, `repo`, `created_at`; TTL 2h for stale cleanup when run not found.

**Runbook:**
1. Ensure no active requests target the workspace (or they will fail when workspace is archived).
2. Call `POST /api/workspaces/:id/destroy` (admin role).
3. Response includes `runId` and `url` to the GitHub Actions run.
4. Monitor the workflow. On success, the webhook automatically sets `archived_at`.
5. The repo folder `envs/<key>/<slug>/` may remain as an empty shell; Terraform state is destroyed. No direct git folder deletion.

**Facts-only ethos:** S3 indexes (`webhooks/github/workspace-destroy/`) are correlation caches, never authoritative. Correlation is derivable from the workflow dispatch (workflow inputs carry workspace identity; webhook uses index first, then payload on miss). Authoritative state: Postgres `archived_at`, GitHub run status. Indexes are repairable — if lost, webhook can still archive when payload includes inputs.

**Failure modes:**
- **Run ID not resolved** — Dispatch succeeded but listing didn't find the run within ~24s. Check GitHub Actions manually; archive will still occur when webhook fires on completion.
- **Webhook not received** — If the webhook delivery fails, the workspace may not be archived. **Repair:** `UPDATE workspaces SET archived_at = NOW() WHERE workspace_id = ?` (or use a future repair endpoint).

---

## Rebuild and prune Postgres index

The requests list is served from Postgres `requests_index`. The index is write-through (updated after each S3 save). If the index is missing rows or has stale/orphan rows, rebuild from S3.

| Task | Command |
|------|---------|
| Rebuild index from S3 | `npm run db:rebuild-index` |
| Rebuild and remove rows for requests no longer in S3 | `npm run db:rebuild-index -- --prune` |

- **Script:** `scripts/rebuild-requests-index.ts`. Requires `DATABASE_URL` (or `PG*` env) and `TFPILOT_REQUESTS_BUCKET`.
- Rebuild upserts every S3 request document into `requests_index` using the same projection as the write-through path (`lib/db/indexer.ts`: `projectRequestToIndexValues`, `INDEX_UPSERT_SQL`). With `--prune`, rows whose `request_id` is not in S3 are deleted.
- See [POSTGRES_INDEX.md](POSTGRES_INDEX.md) for schema and write-through boundary.

---

## Verify Postgres connectivity

- **Health endpoint:** `GET /api/health/db` returns `{ ok: true }` when the DB is reachable, or `{ ok: false, error: "..." }` with status 503 when not configured or unreachable.
- **Local:** Ensure `DATABASE_URL` is set in `.env.local`, then `curl -s http://localhost:3000/api/health/db`.
- **Migrations:** Run `npm run db:migrate` to apply pending migrations (see `migrations/`). Requires `DATABASE_URL` or `PGHOST`/`PGUSER`/etc. After adding `workspace_slug` to `requests_index`: run `npm run db:rebuild-index` to backfill existing rows.

---

## Common failure scenarios

| Scenario | Meaning | What to do |
|----------|---------|------------|
| **GET /api/requests returns 503** | Database not configured or unreachable. List **requires** Postgres. | Set `DATABASE_URL` (or `PGHOST`, `PGUSER`, etc.). Check ECS task has secret `DATABASE_URL` from Secrets Manager. Verify Postgres is reachable from the app (security groups, private DNS). |
| **list_errors with error "NoSuchKey"** | Index row exists but S3 object `requests/<requestId>.json` is missing (e.g. deleted or never written). | Treat as orphan index row. Run `npm run db:rebuild-index -- --prune` to remove such rows from the index. Optionally restore the S3 object if it was deleted by mistake. |
| **index_drift: true on a request** | Index row’s `doc_hash` does not match the hash of the current S3 document. Index is stale. | Rebuild index for that request (or run full `npm run db:rebuild-index`) so the index row is updated from S3. Drift is detected in `app/api/requests/route.ts` (GET list) and returned as `index_drift`, `index_doc_hash`, `s3_doc_hash`. |
| **Invalid or malformed cursor** | Client sent a bad `cursor` query param (not valid base64url JSON). | Ensure cursor is the exact `next_cursor` value from the previous page; do not modify or truncate. See [API.md](API.md). |

---

## Request stuck states

| Symptom | What to do |
|---------|------------|
| **Stuck “planning” or “applying”** | Sync fetches and patches when the current attempt satisfies **needsReconcile** (runId present, conclusion or completedAt missing). Open the request so the UI polls (or call GET `/api/requests/:id/sync?repair=1`). Use repair if runId was never set. |
| **Stuck “destroying”** | Sync fetches the destroy run when the current destroy attempt satisfies needsReconcile, so UI polling converges. If no conclusion for >15 min, status derives to failed; use Repair (sync with ?repair=1) to refresh or retry cleanup. |
| **List shows stale status** | List is revalidated via global SSE (root layout): on request event, `req:${id}` mutated immediately and `/api/requests` after 300ms debounce. Trigger sync on the request or wait for next SSE-driven revalidation. |

---

## Repair endpoint usage

- **GET** `/api/requests/:requestId/sync?repair=1` — Forces full GitHub fetch and patch (PR, reviews, cleanup PR, and current run attempts by runId). Use when you suspect missing facts or stale destroy.
- **GET** `/api/requests/:requestId/sync?hydrate=1` — Same as repair for “do GitHub calls” (no semantic difference in current code).
- Requires session + GitHub token. On success returns `request` with derived `status` and `sync: { mode: "repair" }`.

---

## Re-sync guidance

- Normal sync runs when `needsRepair(request)` is true **or** when any current attempt (plan/apply/destroy) satisfies **needsReconcile** (runId present and either conclusion or completedAt missing). In the latter case sync fetches that run and patches the attempt, so "stuck destroying" (or planning/applying) converges without `?repair=1`. No query param needed for that. Use `?repair=1` to force full GitHub fetch (e.g. missing runId resolution, PR/cleanup refresh, stale destroy).
- To force re-sync even when repair not needed: use `?repair=1` or `?hydrate=1`.
- After approve/merge/apply/destroy, UI typically revalidates; webhooks also patch. If events were lost, use repair once.

---

## Safely resetting dev (state + requests)

**Warnings:**

- Resetting Terraform state and/or archiving requests in dev is destructive. Only do this in a dedicated dev environment.
- Ensure no one relies on existing dev resources or request history before reset.

**Suggested steps (operator-owned):**

1. **State:** In the infra repo, for the dev env, either remove or reset the state object (e.g. S3 state key / DynamoDB lock). Follow your org’s Terraform state backup/restore policy.
2. **Requests:** TfPilot does not provide a “delete all requests” API. To clear or archive dev requests you would need to use S3 directly (e.g. list/delete under `requests/` or move to `history/`) or add an admin-only endpoint. Document any such procedure in your runbook.
3. **Run index:** Optional cleanup of `webhooks/github/run-index/` in the requests bucket if you want to avoid stale runId→requestId mappings. Not required for correctness; fallbacks exist.

**Known gap:** No in-app “reset dev” button or single API. Operations are manual (state) and/or S3/admin (requests). See **docs/SYSTEM_OVERVIEW.md** for storage layout.

---

## Known gaps (docs only)

If you find behavior that contradicts these docs or intended behavior, add a short “Known gap” note here with file references. Do not refactor application logic in the docs-only pass.
