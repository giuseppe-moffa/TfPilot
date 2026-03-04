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
| **drift_plan** | Drift detection plan (e.g. nightly on base branch). Env-scoped in Model 2 (`environment_key` + `environment_slug`). |

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

## Environment and deploy

| Term | Meaning |
|------|---------|
| **Environment** | A target root `envs/<environment_key>/<environment_slug>/` with isolated Terraform state. Created via POST `/api/environments`; stored in Postgres. |
| **Environment Template** | Static config in `config/environment-templates.ts`. One template = N modules baseline bundle. IDs: `blank`, `baseline-ai-service`, `baseline-app-service`, `baseline-worker-service`. Templates generate bootstrap request files via `envSkeleton`. |
| **Environment Deploy** | Action that creates branch `deploy/<key>/<slug>`, commits bootstrap Terraform root (backend.tf, providers.tf, versions.tf, base.tf, request files), opens PR. Admin-only. POST `/api/environments/:id/deploy`. |
| **Deploy detection** | Derived from GitHub repo: `deployed` = `envs/<key>/<slug>/backend.tf` exists on default branch; `deployPrOpen` = open PR with head `deploy/<key>/<slug>`. Fail-closed on GitHub check failure → `ENV_DEPLOY_CHECK_FAILED`. |
| **Deploy error codes** | `ENV_ALREADY_DEPLOYED` (409), `ENV_DEPLOY_IN_PROGRESS` (409 — branch exists or deploy PR open; both treated same), `ENV_DEPLOY_CHECK_FAILED` (503), `INVALID_ENV_TEMPLATE` (400). |
| **Environment Activity** | Timeline at `GET /api/environments/:id/activity`. Derived from Postgres request index + deploy status; no S3 reads. Events: `environment_deployed`, `environment_deploy_pr_open`, `request_created`. When deploy check fails, deploy events omitted, `warning: "ENV_DEPLOY_CHECK_FAILED"` returned. |
| **New Request gating** | "New Request" disabled when `deployed=false`, `deployPrOpen=true`, or deploy check fails. Messages: "Environment must be deployed before creating resources", "Environment deployment in progress", "Cannot verify deploy status". Centralized in `lib/new-request-gate.ts`. |

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
