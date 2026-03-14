# TfPilot system overview

**Doc index:** [docs/DOCS_INDEX.md](DOCS_INDEX.md). For codebase layout by domain (what the structure “screams”), see [docs/SCREAMING_ARCHITECTURE.md](SCREAMING_ARCHITECTURE.md).

## What TfPilot is

TfPilot is a **PR-native, deterministic Terraform control plane**: AI-assisted self-service that turns user requests into Terraform changes delivered via GitHub pull requests and executed only in GitHub Actions. No Terraform runs in the app; GitHub is the execution boundary.

**Core promise:** “AI collects inputs, templates generate Terraform.”

---

## Sources of truth

| Store | Role | Authority |
|-------|------|-----------|
| **S3 request document** | Full request JSON (facts, runs, PR, approval, lock, etc.). Path: `requests/<requestId>.json`. | **Authoritative.** All lifecycle and status are derived from this document. |
| **Postgres `requests_index`** | Index/projection for list and pagination only. | **Projection only.** No lifecycle or status column. Used for ordering and cursor pagination; can be rebuilt from S3. |
| **Postgres `orgs`** | Org tenancy: id, slug, name, archived_at. | **Authoritative** for org identity and lifecycle. |
| **Postgres `org_memberships`** | Org membership: org_id, login, role. | **Authoritative** for who belongs to which org. |
| **Postgres `teams`, `team_memberships`, `project_team_access`** | Team → project access model. | **Authoritative** for project access grants. |

**Key invariant:** Request lifecycle and status are **never** stored as truth in Postgres. They are always derived from the S3 document via `deriveLifecycleStatus(request)` (see [REQUEST_LIFECYCLE.md](REQUEST_LIFECYCLE.md)). The index is write-through: after every S3 save, the app upserts the row; index write failures are logged and do not block persistence. See [POSTGRES_INDEX.md](POSTGRES_INDEX.md).

---

## Multi-org architecture

TfPilot is **multi-tenant** at the org level. All workspaces, requests, projects, and teams are scoped to an **org**.

### Org model

| Table | Purpose |
|-------|---------|
| **orgs** | `id`, `slug`, `name`, `created_at`, `updated_at`, `archived_at` (NULL = active) |
| **org_memberships** | `org_id`, `login`, `role` (viewer, developer, approver, admin) |

- **Session org context:** The active org is stored in the session cookie (`orgId`, `orgSlug`). Org-scoped APIs use `session.orgId` only; never from client.
- **Org switching:** `GET /api/auth/orgs` returns orgs the user belongs to (excludes archived). `POST /api/auth/switch-org` updates session with new orgId/orgSlug. `orgSlug` comes from DB only, never from client.

### Platform admin vs org admin vs project access

| Role | Identity | Scope | Capabilities |
|------|----------|-------|--------------|
| **Platform admin** | `isPlatformAdmin(login)` (platform_admins table) | Whole platform | List/create/archive/restore orgs; view any org detail; bypass archived-org enforcement on platform routes |
| **Org admin** | `org_memberships.role === "admin"` | Single org | Manage members, teams, project access within that org |
| **Project access** | Team membership or org admin | Per project | Required for create/approve/apply/deploy/destroy on resources in that project |

**Dual permission model:** RBAC (role) gates *what* action is allowed; project access gates *which* project the user may operate on. Both must pass. See [RBAC.md](RBAC.md) and [ORGANISATIONS.md](ORGANISATIONS.md).

---

## Org lifecycle and archived enforcement

### Org lifecycle

- **Create:** `POST /api/platform/orgs` — platform-admin only. Body: `slug`, `name`, `adminLogin`. Creates org + initial admin membership atomically.
- **Archive:** `POST /api/platform/orgs/[orgId]/archive` — sets `archived_at = NOW()`. Idempotent.
- **Restore:** `POST /api/platform/orgs/[orgId]/restore` — clears `archived_at`. Idempotent.

### Archived organization runtime enforcement

When `session.orgId` points to an **archived org**, org-scoped APIs return **403** `{ error: "Organization archived" }`.

- **Guard:** `requireActiveOrg(session)` in `lib/auth/requireActiveOrg.ts`. Applied after session/orgId checks in all org-scoped routes.
- **Exclusions:** Archived orgs are excluded from `GET /api/auth/orgs` (org switcher). `POST /api/auth/switch-org` rejects switching to an archived org (400).
- **Platform admin bypass:** Platform routes (`GET/POST /api/platform/orgs`, `GET /api/platform/orgs/[orgId]`, archive, restore) do **not** use `requireActiveOrg`. Platform admins can list, view, archive, and restore orgs even when their current session org is archived.

---

## Projects and workspaces (first-class)

**Projects** and **workspaces** are user-created, user-managed resources. The hierarchy is: Organization → Project → Workspace → Request.

| Table | Purpose |
|-------|---------|
| **projects** | `id`, `org_id`, `project_key`, `name`, `repo_full_name`, `default_branch`. User-created. Defines the infra repo and RBAC boundary. |
| **workspaces** | `workspace_id`, `org_id`, `project_key`, `repo_full_name`, `workspace_key`, `workspace_slug`. Terraform root + state boundary. Created inside a project. |
| **teams** | `id`, `org_id`, `slug`, `name` |
| **team_memberships** | `team_id`, `login` |
| **project_team_access** / **project_team_roles** | Project access grants (team or user roles) |

**Project lifecycle:** Create project (`POST /api/projects`, `/projects/new`) with name, project_key, repo_full_name, default_branch. Creator is auto-assigned as project admin. Update via `/projects/[projectId]/settings`. Access (teams, users) via `/projects/[projectId]/access`.

**Workspace lifecycle:** Create workspace (`POST /api/workspaces`, `/projects/[projectId]/workspaces/new`) inside an existing project. Workspace creation reads `repo_full_name` and `default_branch` from the project record — no static config. Bootstrap PR creates `envs/<workspace_key>/<workspace_slug>/`.

**Team → project access:** Users gain access to a project if (a) they are org admin, or (b) they have a direct project role, or (c) they are in a team with project access. All request lifecycle and workspace APIs check both RBAC and project access. Cross-org: `resource.org_id` must match `session.orgId`; otherwise 404.

---

## Platform admin system

**API:** `GET/POST /api/platform/orgs`, `GET /api/platform/orgs/[orgId]`, `POST /api/platform/orgs/[orgId]/archive`, `POST /api/platform/orgs/[orgId]/restore`. Platform-admin only (404 for non-admins).

**UI:** `/settings/platform/orgs` — list orgs (filter: active/archived/all), create org, view org detail, archive, restore.

**Capabilities:** List orgs with member counts; create org with initial admin; archive/restore org; view org detail (members, teams, stats). Non-platform-admin callers receive 404 (same denial as org-not-found).

---

## Runtime guard: requireActiveOrg

`requireActiveOrg(session)` in **lib/auth/requireActiveOrg.ts** returns 403 `{ error: "Organization archived" }` when `session.orgId` exists and the org is archived. Applied after session/orgId checks in all org-scoped routes (requests, workspaces, request-templates, workspace-templates, metrics/insights, org members/teams/projects, etc.). Platform routes do **not** use this guard.

---

## Architecture (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│                     TfPilot (Next.js)                             │
│  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ App Router │  │ API Routes │  │ Auth       │  │ SSE stream  │  │
│  │ (pages)    │  │ (requests, │  │ (session,  │  │ (updates)   │  │
│  │            │  │  github,   │  │  roles)    │  │             │  │
│  │            │  │  sync)     │  │            │  │             │  │
│  └─────┬──────┘  └─────┬─────┘  └─────┬──────┘  └──────┬──────┘  │
│        │                │              │                │         │
│        └────────────────┼──────────────┼────────────────┘         │
│                          │              │                          │
│  ┌───────────────────────┴──────────────┴───────────────────────┐│
│  │  S3 (requests bucket)                                         ││
│  │  requests/<id>.json  history/<id>.json  logs/  run-index/     ││
│  └───────────────────────────────┬──────────────────────────────┘│
└──────────────────────────────────┼─────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │  GitHub                  │                         │
        │  PRs, branches, workflow_run / pull_request       │
        │  webhooks → POST /api/github/webhook              │
        │  Actions: plan, apply, destroy, cleanup, drift_plan│
        └──────────────────────────────────────────────────┘
```

---

## Components

| Component | Role |
|-----------|------|
| **Next.js UI** | Request list (filters, dataset modes), request detail (timeline, actions, plan diff), new request form, assistant. SWR + optional SSE for freshness. |
| **API routes** | Request CRUD, sync (repair/hydrate), approve, merge, apply, destroy, webhook receiver, drift-eligible/drift-result, assistant state, logs. |
| **S3 request storage** | `requests/<requestId>.json` (optimistic `version`). Destroyed → `history/<requestId>.json`. Lifecycle logs `logs/<requestId>/<ts>.json`. Run index: `webhooks/github/run-index/<kind>/` (see **docs/RUN_INDEX.md**). |
| **GitHub workflows** | Plan, apply, destroy, cleanup, drift_plan (infra repos). Dispatched by TfPilot; concurrency per workspace/state group. |
| **Webhooks** | `pull_request`, `pull_request_review`, `workflow_run` → correlate to request, patch facts only, push SSE event. |
| **SSE** | Single global subscriber in root layout (`RequestStreamRevalidator`). On each request event: mutate `req:${id}` immediately; debounce 300ms and mutate `/api/requests` so list and detail stay fresh. No duplicate subscribers. |

---

## Data model (request shape)

- **Identity:** `id`, `version` (optimistic lock).
- **Target:** `targetOwner`, `targetRepo`, `branchName`, `targetFiles`, env/module/project.
- **PR:** `pr` or `github.pr` (number, url, merged, headSha, open).
- **Run execution:** All workflow execution state lives under `request.runs` (plan, apply, destroy). See **Run execution model** below.
- **Approval:** `approval.approved`, `approval.approvers`.
- **Merge:** `mergedSha` (set by merge route).
- **Cleanup:** `cleanupPr`, `timeline` (steps including Cleanup PR opened/merged).
- **Status:** Not stored authoritatively; derived by `deriveLifecycleStatus(request)` (see REQUEST_LIFECYCLE.md).

---

## Run execution model

All workflow execution state is stored under `request.runs`. There is no legacy run state (no top-level run fields or `github.workflows` run state).

```ts
request.runs = {
  plan:   { currentAttempt: number, attempts: AttemptRecord[] },
  apply:  { currentAttempt: number, attempts: AttemptRecord[] },
  destroy: { currentAttempt: number, attempts: AttemptRecord[] }
}
```

**AttemptRecord** (per attempt):

| Field | Type | Description |
|-------|------|-------------|
| `attempt` | number | 1-based attempt index |
| `runId` | number | GitHub Actions run ID |
| `url` | string | Run URL |
| `status` | string | `"queued"` \| `"in_progress"` \| `"completed"` \| `"unknown"` |
| `conclusion` | string? | `"success"` \| `"failure"` \| `"cancelled"` \| etc. |
| `dispatchedAt` | string | ISO timestamp when dispatch occurred |
| `completedAt` | string? | ISO timestamp when run completed |
| `headSha` | string? | Commit SHA (plan) |
| `actor` | string? | Who triggered (apply/destroy) |

**Current attempt:** The latest attempt for each kind is the one where `attempt === currentAttempt`. Helpers: `getCurrentAttemptStrict(request.runs, "plan"|"apply"|"destroy")` in **lib/requests/runsModel.ts**. Attempts may have optional `runId`/url (e.g. plan attempt created at dispatch before runId is known); webhook/sync can attach runId by matching head_sha.

- **Dispatch:** Plan/apply/destroy routes call `persistDispatchAttempt(...)` to append a new attempt (status `queued`, headSha/ref/actor; runId/url when available) and write the run index when runId is known. Plan attempt is always created at dispatch.
- **Webhook:** `workflow_run` events are correlated via run index (or head_sha for attempts without runId); the matching attempt is patched (runId/url, status, conclusion, completedAt, headSha). No other run state is written.
- **Sync:** GET sync fetches the run and patches the attempt when **needsReconcile(attempt)** — i.e. current attempt has runId and no conclusion — for plan, apply, and destroy (status-agnostic). Also runs when `needsRepair(request)` or `?repair=1` (e.g. to resolve missing runId). A noop cooldown (60s, in-memory) applies when a reconcile fetch returns a non-terminal payload and produces no persisted patch. No canonicalization or legacy repair.
- **Retry:** A retry (e.g. “Retry apply”) creates a new attempt (attempt 2, 3, …); `currentAttempt` moves to the new attempt.

---

## Execution integrity principles

- **Single canonical run model** — Only `request.runs.{plan,apply,destroy}` hold execution state; no dual-write, no legacy fields.
- **Attempt-based execution** — Each dispatch adds an attempt; lifecycle and UI use the current attempt only.
- **Idempotent dispatch** — Dispatch routes use idempotency keys; replay returns existing run info from current attempt.
- **RunId-based correlation** — Run index (S3) maps runId → requestId; webhooks resolve request then patch the attempt with that runId.
- **Webhook-first with reconcile fallback** — Webhooks patch attempts; sync reconciles when needed (e.g. missed webhook) by fetching GitHub and patching the same attempt.
- **Derived state from facts only** — Status is always derived by `deriveLifecycleStatus(request)` from PR, approval, mergedSha, and current attempts; never stored as authoritative.

---

## Lifecycle guarantees

The lifecycle engine enforces **monotonic patching** (no regressing completed state), **deterministic reconciliation** (reconcile eligibility and fetch rules), and **derived, replayable audit** (events from request facts only). These guarantees are formally specified in **[docs/INVARIANTS.md](INVARIANTS.md)** and enforced by the **invariant test suite** (`tests/invariants/`, `npm run test:invariants`). See that doc for the full contract and test checklist.

---

## Workspace lifecycle and deploy

- **Create:** POST `/api/workspaces` — creates DB record (project_key, workspace_key, workspace_slug, template_id, template_version, template_inputs). `template_id` validated against S3 workspace template index; invalid → 400. Template document loaded from S3; inputs validated and defaults resolved.
- **Deploy:** POST `/api/workspaces/:id/deploy` — creates branch `deploy/<key>/<slug>`, commits bootstrap Terraform root via `lib/workspaces/workspaceSkeleton`, opens PR. Admin-only. Returns `deploy.pr_url`, `deploy.pr_number`. Atomic rollback on PR failure (delete request docs, delete branch).
- **Deploy detection:** Workspace deploy status uses `lib/workspaces/isWorkspaceDeployed` (GitHub API): `deployed` = `backend.tf` exists on default branch; `deployPrOpen` = open PR with head `deploy/<key>/<slug>`; `deployPrUrl` when PR exists; `envRootExists` = workspace root exists. Fail-closed: GitHub check failure → `WORKSPACE_DEPLOY_CHECK_FAILED`.
- **UI gating:** "New Request" disabled when `deployed=false`, `deployPrOpen=true`, or deploy check fails. Messages: "Workspace must be deployed before creating resources", "Workspace deployment in progress", "Cannot verify deploy status". `lib/new-request-gate.ts` centralizes gating logic.

**Workspace Activity:** Workspace activity timeline is derived from Postgres request index + deploy status (no S3 reads). Event types: `workspace_deployed`, `workspace_deploy_pr_open`, `request_created`. When GitHub deploy check fails, deploy events are omitted and `warning: "WORKSPACE_DEPLOY_CHECK_FAILED"` is returned. See [API.md](API.md).

**Workspace Deploy Flow (textual):**

```
Create workspace (POST /api/workspaces)
  → DB record created; optional bootstrap PR for repo setup

Deploy workspace (POST /api/workspaces/:id/deploy)
  → branch deploy/<key>/<slug>
  → commits bootstrap Terraform root (backend.tf, providers.tf, versions.tf, base.tf, request files from template)
  → opens PR

Merge deploy PR
  → backend.tf exists on default branch
  → workspace becomes deployed (deployed=true)

Requests can now be created (New Request enabled).
```

---

## Terraform repo structure (Model 2)

Infra repos use multi-environment roots:

```
envs/<workspace_key>/<workspace_slug>/
  backend.tf
  providers.tf
  versions.tf
  tfpilot/
    base.tf
    requests/
      <module>_req_<request_id>.tf
      .gitkeep
```

- Request files use canonical naming: `<module>_req_<request_id>.tf` (e.g. `ecr-repo_req_a12bc3.tf`). No `req_<id>.tf` legacy format.
- Deploy creates this structure from workspace templates. Merge deploy PR → `backend.tf` exists → workspace becomes deployed; requests can then be created.

---

## Module Registry

Defined in `config/module-registry.ts`. Registry modules define schema and request config for AI-assisted form generation. Current modules: **s3-bucket**, **ec2-instance**, **ecr-repo**, **cloudwatch-log-group**, **iam-role**.

**Note:** Registry modules define the platform schema; corresponding Terraform modules may not yet exist in infra repos. Workspace templates reference registry keys; templates may omit modules until Terraform implementations exist.

---

## Repositories

- **Platform repo (TfPilot):** This app. Next.js, API, S3, GitHub API, webhooks, SSE.
- **Infra repos (per project):** e.g. `core-terraform`, `payments-terraform`. Contain `envs/<key>/<slug>/`, `modules/`, `.github/workflows` (plan, apply, destroy, cleanup, drift-plan). TfPilot writes one file per request at `envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf`.

---

## Tier-A invariants (what code enforces)

| Invariant | Enforcement |
|-----------|-------------|
| Terraform runs **only** in GitHub Actions | No Terraform binary or state in the app; workflows run in infra repos. |
| S3 request document is authoritative | All reads for request detail/list hydrate from S3 (list uses index for ordering, then fetches doc per row). `lib/storage/requestsStore.ts`: `getRequest`, `saveRequest`. |
| Postgres is index/projection only; no lifecycle in DB | Schema has no status column. `lib/db/indexer.ts`: projection fields only; `deriveLifecycleStatus` in app only. |
| Write-through indexing after S3 save | `saveRequest` in `lib/storage/requestsStore.ts` calls `upsertRequestIndex` after `putRequest`; index failures do not throw. |
| TfPilot writes one file per request | `lib/renderer/model2` generates `envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf`; no multi-request blocks. |
| Status is derived from facts only | `lib/requests/deriveLifecycleStatus.ts`; webhooks/sync patch facts in S3, never write status. |
| GitHub is the execution boundary | Workflow dispatch and run correlation via run index; no local run execution. |

See [INVARIANTS.md](INVARIANTS.md) for the full formal checklist.

---

## Correctness guarantees

- **Facts-only model** — Only PR, runs (attempts), approval, mergedSha are stored; status is never stored as truth.
- **Monotonic patching** — Attempt patches never regress (no overwriting completed with in_progress; conclusion never cleared).
- **Attempts-first lifecycle** — Current attempt = attempt where `attempt === currentAttempt`; terminality is determined by conclusion, not status string.
- **Reconciliation invariant** — If runId exists and conclusion is missing, the attempt is eligible for reconciliation; sync fetches run and patches monotonic.
- **Cooldown guard** — Sync noop + non-terminal payload triggers 60s in-memory cooldown per attempt to avoid API hammering.
- **SSE-driven freshness** — Single global SSE subscriber in root layout; on request event, mutate request key immediately and list key after 300ms debounce.
- **Stale destroy guard** — runId + no conclusion + past threshold (e.g. 15 min after dispatchedAt) → derived status `failed`; no status string trusted for liveness.

---

## Observability and Insights

- **Insights page** (`/insights`): Dashboard of platform metrics (cached ~60s) and in-memory GitHub API usage. Requires session. See [docs/INSIGHTS.md](INSIGHTS.md) for full feature docs.
- **Ops metrics** (`GET /api/metrics/insights`): Org-scoped aggregates from Postgres request index + S3 — total requests, apply/plan success rates (7d), failures (24h/7d), status distribution, activity windows, durations (e.g. Created → Plan ready). Requires `session.orgId`; blocked by `requireActiveOrg` when org is archived. Served by **lib/observability/ops-metrics.ts**; cached ~60s.
- **GitHub API usage** (`GET /api/metrics/github`): In-memory only (same process; resets on deploy/restart). Single call-site: **lib/github/client.ts** `ghResponse()` calls `recordGitHubCall()`. Snapshot includes:
  - **Windows:** 5m and 60m rolling aggregates (calls, rate-limited, success/client/server/fetch errors).
  - **Last-seen rate limit:** remaining/limit, reset, observedAt.
  - **Top routes (60m):** Up to 8 normalized routes by call count.
  - **Hot routes (5m):** Top 5 normalized routes in last 5 minutes.
  - **Rate-limit burst (5m):** Boolean — true if any rate-limited response in 5m or remaining/limit &lt; 10%.
  - **Last rate-limit events:** Ring of last 20 events; each event has route, status, remaining/limit/reset, and optional **kindGuess** (best-effort: e.g. `run`, `pr`, `reviews`, `jobs` from path).
- **lib/observability:** `ops-metrics.ts` (request-based aggregates), `github-metrics.ts` (in-memory GitHub usage, route normalization, `inferKindGuess`), `useInsightsMetrics.ts` / `useGitHubMetrics.ts` (SWR hooks for UI).

---

## Future roadmap (not yet implemented)

- **Drift detection:** Active drift status per workspace; UI indicators.
- **Plan/apply activity events:** Activity timeline could include `plan_succeeded`, `apply_succeeded`, `destroy_succeeded` when run/attempt data is available from the index (currently Postgres projection has no runs).
- **Workspace health indicators:** Consolidated health status per workspace (deploy, drift, request count).

---

## Org Lifecycle Test Coverage

The invariant test suite (`npm run test:invariants`) includes **273 tests** covering:

- **Org lifecycle:** Archive/restore (sets archived_at, idempotent); org creation (valid, duplicate slug, missing fields); org detail (404, archived visible to platform admin, members/teams/stats shape).
- **Archived org enforcement:** Active org → normal behavior; archived org → 403 "Organization archived" on GET/POST requests, workspaces, metrics/insights, request-templates/admin; platform routes bypass enforcement.
- **Platform admin gating:** Non-platform-admin → 404 on GET/POST /api/platform/orgs, GET /api/platform/orgs/[orgId], archive, restore.
- **Org switching:** GET /api/auth/orgs excludes archived; POST switch-org to archived rejected; switch to active succeeds.
- **RBAC + project access:** Deploy, apply, approve, destroy, project access enforcement (see `tests/api/projectAccessEnforcementRoute.test.ts`, `tests/unit/projectAccessEnforcement.test.ts`, `tests/api/orgLifecycleRoute.test.ts`, `tests/unit/orgLifecycle.test.ts`).

---

## Glossary

See **docs/GLOSSARY.md** for workflow kinds, canonical statuses, Repair, and observability terms.
