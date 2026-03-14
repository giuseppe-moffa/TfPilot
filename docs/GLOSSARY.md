# Glossary

Consistent terminology for TfPilot docs and code.

---

## Documentation

| Term | Meaning |
|------|---------|
| **DOCS_INDEX** | `docs/DOCS_INDEX.md` — canonical list of all docs, status (KEEP/ARCHIVE), and last-updated. Use for navigation and to find current canonical docs. |
| **Canonical docs** | SYSTEM_OVERVIEW, REQUEST_LIFECYCLE, GITHUB_WORKFLOWS, WEBHOOKS_AND_CORRELATION, OPERATIONS, GLOSSARY, RUN_INDEX, POSTGRES_INDEX, API, INVARIANTS. See DOCS_INDEX for full list. Lifecycle/webhook context: REQUEST_LIFECYCLE, GITHUB_WORKFLOWS, WEBHOOKS_AND_CORRELATION. |

---

## Workflow kinds

| Kind | Meaning |
|------|---------|
| **plan** | Terraform plan workflow (request-scoped). |
| **apply** | Terraform apply workflow (env-state serialized). |
| **destroy** | Terraform destroy workflow (env-state serialized). |
| **cleanup** | Cleanup workflow: strip TfPilot block, open cleanup PR. |
| **drift_plan** | Drift detection plan (e.g. nightly on base branch). Workspace-scoped in Model 2. |

Defined in **lib/github/workflowClassification.ts** (`WorkflowKind`). Used in run index and webhook classification. See **docs/DRIFT_DETECTION.md**.

---

## Canonical statuses

Display status set (see **lib/status/status-config.ts**):  
`request_created`, `planning`, `plan_ready`, `approved`, `merged`, `applying`, `applied`, `destroying`, `destroyed`, `failed`.

- **Terminal:** `applied`, `destroyed`, `failed`.
- **Active (polling/SSE):** `planning`, `applying`, `destroying`.

All derived by `deriveLifecycleStatus(request)`; not stored as source of truth (see **docs/REQUEST_LIFECYCLE.md**).

---

## Repair

- **Meaning:** Sync that performs GitHub API calls to refresh request facts (PR, reviews, workflow runs) and optionally retry cleanup dispatch after destroy success.
- **When:** Sync runs GitHub fetch when `needsRepair(request)` is true, when the client calls sync with `?repair=1` or `?hydrate=1`, or when any current attempt (plan/apply/destroy) satisfies **needsReconcile** (runId present and either conclusion or completedAt missing), so "stuck" states and missing completion time converge without manual repair.
- **Endpoint:** GET `/api/requests/:requestId/sync` (with optional `repair=1` or `hydrate=1`). Implemented in **app/api/requests/[requestId]/sync/route.ts**; policy in **lib/requests/syncPolicy.ts**.

---

## Request lock

- **Meaning:** Per-request mutex stored as `request.lock` (holder, operation, acquiredAt, expiresAt) to prevent concurrent plan/apply/destroy on the same request. Default TTL 2 minutes (**lib/requests/lock.ts** `LOCK_TTL_MS`).
- **Active vs expired:** Only an **active** lock (exists, valid expiresAt, and now &lt; expiresAt) blocks actions. The UI uses `isLockActive(lock)`; the backend uses `isLockExpired(lock, now)` in `acquireLock` so an expired lock is treated as no lock (no `LockConflictError`).
- **Sync clearing:** Sync clears expired locks: if `request.lock` exists and `expiresAt` is in the past, sync removes the lock and persists. With `DEBUG_WEBHOOKS=1`, sync logs `event=sync.lock_cleared_expired`.

---

## Project and workspace

| Term | Meaning |
|------|---------|
| **Project** | User-created, org-scoped resource. Defines `project_key`, `name`, `repo_full_name`, `default_branch`. RBAC boundary. Create via `POST /api/projects` or `/projects/new`. Immutable `project_key`. |
| **Workspace** | Terraform root + state boundary. Created inside a project. Owns `envs/<workspace_key>/<workspace_slug>/`, backend state, deploy/destroy lifecycle. Create via `POST /api/workspaces` or `/projects/[projectId]/workspaces/new`. Reads repo config from project record. |
| **Project access** | User/team roles (viewer, planner, operator, deployer, admin) on a project. Managed at `/projects/[projectId]/access`. Required for create/approve/apply/deploy/destroy on resources in that project. |
| **Orphaned workspace** | Workspace whose `project_key` has no matching `projects` row. Audit via `GET /api/admin/audit/workspaces-missing-project`. |

---

## Workspace and deploy

| Term | Meaning |
|------|---------|
| **Workspace** | Terraform root + state boundary: `envs/<workspace_key>/<workspace_slug>/`. Created via POST `/api/workspaces`; stored in Postgres. |
| **Workspace template** | Template document in S3 (`templates/workspaces/<id>/<version>.json`). Index at `templates/workspaces/index.json`. Template-only model. Generates bootstrap request files via `lib/workspaces/workspaceSkeleton`. |
| **Workspace deploy** | Action that creates branch `deploy/<key>/<slug>`, commits bootstrap Terraform root (backend.tf, providers.tf, versions.tf, base.tf, request files), opens PR. Admin-only. POST `/api/workspaces/:id/deploy`. |
| **Deploy detection** | Derived from GitHub repo: `deployed` = `envs/<key>/<slug>/backend.tf` exists on default branch; `deployPrOpen` = open PR with head `deploy/<key>/<slug>`. Fail-closed on GitHub check failure → `WORKSPACE_DEPLOY_CHECK_FAILED`. |
| **Deploy error codes** | `WORKSPACE_ALREADY_DEPLOYED` (409), `WORKSPACE_DEPLOY_IN_PROGRESS` (409), `WORKSPACE_DEPLOY_CHECK_FAILED` (503), invalid template (400). |
| **Workspace activity** | Timeline derived from Postgres request index + deploy status; no S3 reads. Events: `workspace_deployed`, `workspace_deploy_pr_open`, `request_created`. When deploy check fails, deploy events omitted, `warning: "WORKSPACE_DEPLOY_CHECK_FAILED"` returned. |
| **New Request gating** | "New Request" disabled when `deployed=false`, `deployPrOpen=true`, or deploy check fails. Messages: "Workspace must be deployed before creating resources", "Workspace deployment in progress", "Cannot verify deploy status". Centralized in `lib/new-request-gate.ts`. |

---

## Module Registry

| Term | Meaning |
|------|---------|
| **Module Registry** | `config/module-registry.ts`. Defines schema + request config per module type. Registry keys: `s3-bucket`, `ec2-instance`, `ecr-repo`, `cloudwatch-log-group`, `iam-role`. Terraform modules may not yet exist in infra repos; registry defines platform schema. |

---

## Observability

| Term | Meaning |
|------|---------|
| **Insights** | Dashboard at `/insights`: ops metrics (request counts, success rates, status distribution, durations) and GitHub API usage (in-memory). Data from GET `/api/metrics/insights` and GET `/api/metrics/github`; session required. |
| **GitHub API usage metrics** | In-memory counters and windows in **lib/observability/github-metrics.ts**. Recorded only in **lib/github/client.ts** `ghResponse()` (one call per real response). Rolling 5m/60m buckets; top routes (60m), hot routes (5m); last-seen rate-limit headers; ring of rate-limit events. Resets on deploy/restart; no DB. |
| **Rate-limit burst (5m)** | Derived boolean in the GitHub metrics snapshot: true if there was any rate-limited response in the last 5 minutes, or if remaining/limit &lt; 10%. Surfaces “rate-limit pressure” in the Insights UI. |
| **kindGuess** | Best-effort label for a rate-limit event inferred from the normalized route path (e.g. `run`, `pr`, `reviews`, `jobs`, `workflow`, `contents`, `dispatch`, `commits`). See `inferKindGuess()` in **lib/observability/github-metrics.ts**. |
