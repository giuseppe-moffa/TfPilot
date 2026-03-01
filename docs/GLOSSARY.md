# Glossary

Consistent terminology for TfPilot docs and code.

---

## Workflow kinds

| Kind | Meaning |
|------|---------|
| **plan** | Terraform plan workflow (request-scoped). |
| **apply** | Terraform apply workflow (env-state serialized). |
| **destroy** | Terraform destroy workflow (env-state serialized). |
| **cleanup** | Cleanup workflow: strip TfPilot block, open cleanup PR. |
| **drift_plan** | Drift detection plan (e.g. nightly on base branch). |

Defined in **lib/github/workflowClassification.ts** (`WorkflowKind`). Used in run index and webhook classification.

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

## Observability

| Term | Meaning |
|------|---------|
| **Insights** | Dashboard at `/insights`: ops metrics (request counts, success rates, status distribution, durations) and GitHub API usage (in-memory). Data from GET `/api/metrics/insights` and GET `/api/metrics/github`; session required. |
| **GitHub API usage metrics** | In-memory counters and windows in **lib/observability/github-metrics.ts**. Recorded only in **lib/github/client.ts** `ghResponse()` (one call per real response). Rolling 5m/60m buckets; top routes (60m), hot routes (5m); last-seen rate-limit headers; ring of rate-limit events. Resets on deploy/restart; no DB. |
| **Rate-limit burst (5m)** | Derived boolean in the GitHub metrics snapshot: true if there was any rate-limited response in the last 5 minutes, or if remaining/limit &lt; 10%. Surfaces “rate-limit pressure” in the Insights UI. |
| **kindGuess** | Best-effort label for a rate-limit event inferred from the normalized route path (e.g. `run`, `pr`, `reviews`, `jobs`, `workflow`, `contents`, `dispatch`, `commits`). See `inferKindGuess()` in **lib/observability/github-metrics.ts**. |
