# TfPilot — Full Platform Architecture Review (Deep Audit)

**Document type:** Read-only technical audit. No code changes or recommendations; current behavior only.

**Audience:** External expert review and competitive benchmarking. Assumes senior platform engineer.

---

## 1. Platform overview

### What TfPilot does

TfPilot is a **Terraform self-service platform** that turns guided user requests into deterministic Terraform changes. Core promise: *"AI collects inputs; templates generate Terraform."*

- Users choose **project**, **environment**, and **module**; a chat agent collects **structured config**.
- The platform persists the request to **S3**, generates bounded Terraform blocks in infra-repo files, and opens a **pull request**.
- **GitHub Actions** run plan (and optionally apply/destroy/cleanup). Users approve → merge → apply; optional destroy triggers cleanup PR then destroy, and the request is archived to `history/`.

### Primary workflow

1. **Create** — POST `/api/requests` with project, environment, module, config → request stored in S3, branch `request/<requestId>` created, PR opened, plan workflow dispatched.
2. **Plan** — GitHub Actions run plan; sync hydrates `planRun` and plan output from runs/artifacts.
3. **Approve** — User approves in GitHub; TfPilot records approval via API and timeline.
4. **Merge** — User (or API) merges PR; update-branch and merge API used as needed.
5. **Apply** — POST apply dispatch → GitHub Actions run apply; sync updates `applyRun`.
6. **Destroy** (optional) — Cleanup workflow strips TfPilot block; destroy workflow runs; request archived to `history/`.

### Main components

| Component | Role |
|-----------|------|
| **Next.js app (App Router)** | UI + API routes; auth, request orchestration, S3 access, GitHub API, UI timeline/actions. |
| **S3 (requests bucket)** | Request documents (`requests/<id>.json`), lifecycle logs (`logs/<requestId>/<ts>.json`), history (`history/<id>.json`). |
| **S3 (chat logs bucket)** | Chat log entries; SSE-S3. |
| **GitHub** | PRs, branches, workflow dispatch (plan/apply/destroy/cleanup), Actions runs, reviews. |
| **Infra repos** | Per-project (e.g. core-terraform, payments-terraform): `envs/dev|prod`, `modules/`, `.github/workflows`. |

### High-level architecture (component diagram description)

```
┌─────────────────────────────────────────────────────────────────┐
│                        TfPilot (Next.js)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   App Router │  │  API Routes  │  │  Auth / Session       │   │
│  │   (pages)    │  │  (requests,  │  │  (cookie, GitHub      │   │
│  │              │  │   github,    │  │   OAuth, roles)       │   │
│  │              │  │   sync, etc) │  │                       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                  │                      │               │
│         │                  │  ┌──────────────────┴─────────────┐ │
│         │                  │  │  lib: storage, lifecycle,      │ │
│         │                  │  │  deriveLifecycleStatus,        │ │
│         │                  │  │  observability, status-config │ │
│         │                  │  └──────────────────┬────────────┘ │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
          │                  ▼                     ▼
          │         ┌───────────────┐     ┌───────────────┐
          │         │  S3 Requests  │     │  GitHub API   │
          │         │  (requests/,  │     │  (PRs, runs,  │
          │         │   logs/,      │     │   dispatch)   │
          │         │   history/)   │     │               │
          │         └───────────────┘     └───────┬───────┘
          │                                      │
          │                                      ▼
          │                             ┌───────────────┐
          │                             │ GitHub Actions│
          │                             │ (plan/apply/  │
          │                             │  destroy/     │
          │                             │  cleanup)     │
          │                             └───────────────┘
          ▼
   ┌───────────────┐
   │  Browser UI   │  ← SWR polling /sync, list GET, actions
   └───────────────┘
```

- **Execution boundary:** Terraform runs only in GitHub Actions. No local Terraform in the app.
- **Single app process:** No custom Node server; Next.js default server. No `middleware.ts`; protection is per-route.

---

## 2. Request lifecycle architecture

### How lifecycle is derived

Status is a **pure function of runtime facts** (Lifecycle Model V2). One entrypoint: `deriveLifecycleStatus(request)` in `lib/requests/deriveLifecycleStatus.ts`. It returns a **canonical status** used by API, UI, and metrics.

### deriveLifecycleStatus logic

Input: minimal request-like shape with `pr`, `planRun`, `applyRun`, `approval`, `destroyRun`. Output: `CanonicalStatus` from `lib/status/status-config.ts`.

**Priority order (first match wins):**

1. **Destroy:** `destroyRun.status` in_progress/queued → `destroying`; `destroyRun.conclusion === "success"` → `destroyed`; destroy run failed → `failed`.
2. **Apply/plan failures:** `applyRun` or `planRun` conclusion in `["failure","cancelled","timed_out","action_required","startup_failure","stale"]` → `failed`.
3. **Apply running** → `applying`.
4. **Apply success** → `applied`.
5. **PR merged** → `merged`.
6. **Approval approved** → `approved`.
7. **Plan success** → `plan_ready`.
8. **Plan running** → `planning`.
9. **PR open** → `planning`.
10. Default → `request_created`.

**Snippet (core logic):**

```ts
// lib/requests/deriveLifecycleStatus.ts (excerpt)
export function deriveLifecycleStatus(request: RequestLike | null | undefined): CanonicalStatus {
  if (!request) return "request_created"
  const { pr, planRun, applyRun, approval, destroyRun } = request

  if (destroyRun?.status === "in_progress" || destroyRun?.status === "queued") return "destroying"
  if (destroyRun?.conclusion === "success") return "destroyed"
  if (destroyRun?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"
  if (applyRun?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"
  if (planRun?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"
  if (applyRun?.status === "in_progress" || applyRun?.status === "queued") return "applying"
  if (applyRun?.conclusion === "success") return "applied"
  if (pr?.merged) return "merged"
  if (approval?.approved) return "approved"
  if (planRun?.conclusion === "success") return "plan_ready"
  if (planRun?.status === "in_progress" || planRun?.status === "queued") return "planning"
  if (pr?.open) return "planning"
  return "request_created"
}
```

### Lifecycle inputs

- **planRun** — GitHub Actions run: `runId`, `url`, `status`, `conclusion`, `headSha`. Fetched/updated in sync from GitHub API and workflow runs.
- **applyRun** — Same shape; validated against candidate SHAs (mergedSha, commitSha, plan headSha, pr headSha) so only runs for the current branch are kept.
- **pr** — `number`, `url`, `merged`, `open`, `headSha`; hydrated from GitHub pulls and reviews in sync.
- **approval** — `approved`, `approvers`; from GitHub reviews in sync.
- **destroyRun** — Set explicitly on destroy dispatch: `status: "in_progress"`, `runId`, `url`; then conclusion/status updated from GitHub runs in sync.

### Status propagation to API

- **List (GET `/api/requests`):** Each stored request is mapped to `{ ...req, status: deriveLifecycleStatus(req) }`. Response does not persist this; it is derived on each list call.
- **Sync (GET `/api/requests/[requestId]/sync`):** Fetches request, hydrates PR/runs/reviews/destroyRun from GitHub, then `status = deriveLifecycleStatus(request)`; **persists** via `updateRequest` (status, statusDerivedAt, updatedAt, planRun, applyRun, pr, approval, timeline, plan, destroyRun). Sync is the only path that writes derived status to storage (except destroy, which writes destroyRun).
- **Destroy (POST destroy):** Only explicit status-related write: sets `destroyRun: { runId, url, status: "in_progress" }` and `statusDerivedAt`, `updatedAt`. No direct `status` write; status is derived from destroyRun.

### UI consumption

- **List page:** GET `/api/requests` returns requests with derived `status`. Table uses `normalizeRequestStatus(item.status, { isDestroyed, isDestroying })` and `getStatusLabel()` from `lib/status/status-config.ts` for badges.
- **Detail page:** Data from `useRequestStatus(requestId)`, which fetches `/api/requests/[requestId]/sync`. So `request.status` is the derived value persisted by sync. UI uses `requestStatus = request?.status ?? "created"` and `canonicalStatus = normalizeRequestStatus(...)` for `<StatusIndicator status={canonicalStatus} />` and action visibility.

### Timeline construction

- **Stored:** `request.timeline` is an array of steps (e.g. `{ step: "Approved", status?, message?, at }`). Approve/merge/apply/destroy routes append to timeline.
- **Sync** appends "Cleanup PR opened" / "Cleanup PR merged" when `cleanupPr` is present and not already in timeline.
- **Detail UI** renders this list as "Status Timeline"; lifecycle logs in S3 are separate (audit trail), not rendered in the main timeline.

### Lifecycle logging

- **Module:** `lib/logs/lifecycle.ts`.
- **API:** `logLifecycleEvent({ requestId, event, actor?, source?, data? })`. Writes to S3: `logs/<requestId>/<timestamp>.json` in the same requests bucket. Payload: `{ timestamp, requestId, event, actor, source, data }`. Failures are logged to console only so they do not break the flow.
- **Used by:** approve, merge, apply, destroy (e.g. `destroy_dispatched`, `destroy_blocked`), and other lifecycle steps as documented in routes.

---

## 3. State model

### Request document schema

Stored in S3 as JSON. Key fields:

- **Identity / meta:** `id`, `project`, `environment`, `module`, `receivedAt`, `updatedAt`, `version` (optimistic lock), `revision`, `status`, `statusDerivedAt`.
- **Config:** `config` (module inputs), `templateId`, `environmentName`.
- **Git / PR:** `targetOwner`, `targetRepo`, `targetBase`, `targetEnvPath`, `targetFiles`, `branchName`, `prNumber`, `prUrl`, `pr` (object with number, url, merged, open, headSha), `pullRequest` (alias), `commitSha`, `mergedSha`, `activePrNumber`, `previousPrs`.
- **Runs:** `planRun` (runId, url, status, conclusion, headSha), `applyRun` (runId, url, status, conclusion), `destroyRun` (runId, url, status, conclusion).
- **Approval:** `approval` (approved, approvers).
- **Plan output:** `plan` (e.g. output).
- **Cleanup:** `cleanupPr` (number, url, merged, status, etc.).
- **Timeline:** `timeline` (array of { step, status?, message?, at }).
- **Other:** `cost` (merged from cost-service when present), assistant state fields, `render`, `moduleRef`, `registryRef`, etc.

### Stored vs derived fields

- **Stored and authoritative:** All of the above. The only lifecycle field that is **explicitly written by the app** (other than sync’s full derivation) is **destroyRun** (set on destroy dispatch).
- **Derived and then stored by sync:** `status`, `statusDerivedAt`. Sync overwrites them with `deriveLifecycleStatus(request)` so that list/detail and metrics see the same value; list also re-derives so even without sync, list is consistent.
- **Derived only at read time (list):** List GET derives `status` per request and does not persist it.

### Persistence strategy

- **Bucket:** `TFPILOT_REQUESTS_BUCKET`. Region from `TFPILOT_DEFAULT_REGION`.
- **Keys:** `requests/<requestId>.json` (active), `history/<requestId>.json` (archived after destroy), `logs/<requestId>/<timestamp>.json` (lifecycle events).
- **Optimistic locking:** `version` on the document. `saveRequest(request, { expectedVersion })` checks current version before write; `updateRequest(requestId, mutate)` reads, mutates, increments version, saves with expected version. Conflict throws.

### S3 usage

- **Read:** `GetObject` for single request, list uses `ListObjectsV2` then `GetObject` per key (up to limit).
- **Write:** `PutObject` with `ContentType: application/json`, `ServerSideEncryption: "AES256"`.
- **No delete** of request objects for normal flow; destroyed requests are copied to `history/` and the active document is updated with destroyRun (and optionally remains in `requests/` as tombstone).

### updateRequest flow

```ts
// lib/storage/requestsStore.ts (concept)
export async function updateRequest(requestId, mutate) {
  const current = await getRequest(requestId)
  const next = mutate(current)
  const nextVersion = (next?.version ?? current.version) + 1
  const payload = { ...current, ...next, version: nextVersion }
  await saveRequest(payload, { expectedVersion: current.version })
  return payload
}
```

### Sync flow (status persistence)

- GET sync: load request, ensure assistant state, fetch PR + reviews + workflow runs (plan, apply, destroy), validate apply run SHAs, derive `status = deriveLifecycleStatus(request)`, set `request.status`, `statusDerivedAt`, `updatedAt`, send emails on conclusion transitions, append cleanup timeline steps, then `updateRequest(requestId, (current) => ({ ...current, pr, planRun, applyRun, approval, cleanupPr, status, statusDerivedAt, updatedAt, timeline, plan, destroyRun }))`. Returns `{ ok: true, request: updated }` (cost merged in when available).

### Example request JSON shape (minimal)

```json
{
  "id": "req_abc123",
  "project": "core",
  "environment": "dev",
  "module": "s3-bucket",
  "config": { "bucket_name": "my-bucket", "tags": {} },
  "receivedAt": "2025-02-20T10:00:00.000Z",
  "updatedAt": "2025-02-20T10:05:00.000Z",
  "status": "plan_ready",
  "statusDerivedAt": "2025-02-20T10:05:00.000Z",
  "version": 3,
  "targetOwner": "org",
  "targetRepo": "core-terraform",
  "targetBase": "main",
  "targetEnvPath": "envs/dev",
  "branchName": "request/req_abc123",
  "prNumber": 42,
  "pr": { "number": 42, "url": "https://github.com/...", "merged": false, "open": true },
  "planRun": { "runId": 100, "url": "...", "status": "completed", "conclusion": "success" },
  "applyRun": null,
  "approval": null,
  "destroyRun": null,
  "timeline": [{ "step": "Request created", "at": "..." }]
}
```

---

## 4. API architecture

### Major routes and responsibilities

| Route | Method | Responsibility |
|-------|--------|----------------|
| `/api/requests` | POST | Create request: validate payload, resolve infra repo, build config, save to S3, create branch/commit/PR, dispatch plan, return request. |
| `/api/requests` | GET | List requests: listRequests(), map each with `status: deriveLifecycleStatus(req)`, return JSON. |
| `/api/requests/[requestId]` | GET | Get one request (no auth in code); merge cost from cost-service. |
| `/api/requests/[requestId]/sync` | GET | Hydrate from GitHub (PR, runs, reviews), derive status, persist via updateRequest, return request. Requires GitHub token. |
| `/api/requests/update` | POST | Update request (patch/config/target files); session required. |
| `/api/requests/[requestId]/approve` | POST | Record approval (GitHub review + timeline); session + approver/admin role. |
| `/api/requests/[requestId]/apply` | POST | Dispatch apply workflow, record applyRun id/url, timeline; session + approver/admin; prod allowlist. |
| `/api/requests/[requestId]/destroy` | POST | Dispatch cleanup then destroy, set destroyRun, archive to history; session + admin; prod/destroy allowlists. |
| `/api/requests/[requestId]/can-destroy` | GET | Whether request can be destroyed (e.g. applied/destroyed state). |
| `/api/github/plan` | POST | Dispatch plan workflow for requestId; session + token. |
| `/api/github/apply` | POST | Dispatch apply workflow (see apply route). |
| `/api/github/merge` | POST | Merge PR (with optional update-branch retry); session + token. |
| `/api/github/update-branch` | POST | Update branch (merge base, resolve conflicts); used by merge flow. |
| `/api/github/plan-output` | GET | Plan output for request (artifact/logs). |
| `/api/metrics` | GET | Legacy metrics: list 200 requests, aggregate statusCounts, successRate, failureCount, destroyedCount, avgApplySeconds; session. |
| `/api/metrics/insights` | GET | Insights metrics: listRequests(1000), buildOpsMetrics() (deriveLifecycleStatus per row), 60s in-memory cache; session. |
| `/api/health` | GET | Public; `{ status: "ok" }`. |
| `/api/auth/github/start` | GET | OAuth start; redirect to GitHub. |
| `/api/auth/github/callback` | GET | OAuth callback; exchange code, allowlist, set session. |
| `/api/auth/me` | GET | Session from cookies; return user or 401. |
| `/api/requests/drift-eligible` | GET | Webhook; secret header; returns eligible requests for drift. |
| `/api/requests/[requestId]/drift-result` | POST | Webhook; secret header; store drift result on request. |
| Templates, modules, policy, connect/aws, assistant, chat-logs, audit-export, logs, etc. | Various | As per PLATFORM_REVIEW_FOR_AGENT.md. |

### Read vs write paths

- **Read:** GET list (derived status), GET one request, GET sync (read + GitHub fetch + write), GET plan-output, GET metrics/insights, GET logs, GET templates/modules.
- **Write:** POST create, POST update, POST approve, POST apply, POST destroy, POST merge, POST update-branch, POST chat-logs, POST drift-result, POST assistant/state, POST clarifications/respond, template admin, etc.

### Sync vs refresh

- **Sync:** GET `/api/requests/[requestId]/sync` is the **canonical** way to refresh request state. It fetches GitHub data, derives status, and persists. Used by UI via `useRequestStatus` (which calls this URL).
- **Refresh:** The previous refresh endpoint was removed; sync is the single refresh path.

### API consistency and contracts

- **JSON in/out:** Request bodies and responses are JSON. No formal OpenAPI; types and handlers define contracts.
- **Errors:** 400 (validation), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error). JSON bodies with `error` or `errors` as appropriate.
- **Correlation:** Many routes use `withCorrelation(req, {})` and pass correlationId/route to `timeAsync` / logger for tracing.

---

## 5. UI architecture

### Pages and routing

- **App Router:** Next.js 16; routes under `app/`.
- **Main pages:** `/` (redirect), `/login`, `/requests` (list), `/requests/[requestId]` (detail), `/requests/[requestId]/plan` (plan view), `/requests/new` (new request), `/catalogue`, `/catalogue/[id]`, `/environments`, `/aws/connect`, `/insights` (insights dashboard).

### Hooks

- **useRequestStatus(requestId, initial):** SWR on `GET /api/requests/<id>/sync`. Returns `{ request, error, isSyncing, mutate }`. Uses `fallbackData: initial`, `keepPreviousData: true`, `dedupingInterval: 2000`, `refreshInterval: 3000` when status not terminal (applied, complete, failed, destroyed), else 0.
- **useInsightsMetrics():** SWR on `GET /api/metrics/insights`, 45s refresh. Returns `{ metrics, isLoading, error, isValidating, mutate }`.

### Polling strategy

- **Detail:** Polling via SWR `refreshInterval` (3s when non-terminal). Terminal statuses stop polling.
- **List:** Fetched with SWR (no refreshInterval in the snippet; list is typically loaded once or on focus/reconnect).
- **Insights:** 45s refresh for insights metrics.

### Status rendering flow

1. **Data:** Request comes from sync (detail) or list API; both expose derived `status` (list re-derives, sync persists it).
2. **Normalization:** UI uses `normalizeRequestStatus(status, { isDestroying, isDestroyed })` from `lib/status/status-config.ts` to map backend variants to `CanonicalStatus`.
3. **Display:** `getStatusLabel(canonicalStatus)`, `getStatusColor`, `StatusIndicator` (badge + label). Table and detail both use the same status-config for labels so list and detail match.

### Timeline UI

- **Source:** `request.timeline` (array of steps). Rendered on detail page as "Status Timeline."
- **Steps:** e.g. "Request created", "Approved", "Merged", "Apply started", "Cleanup PR opened", etc., with optional status/message and timestamp.

### Insights dashboard

- **Page:** `app/insights/page.tsx` renders `InsightsDashboard`.
- **Data:** `useInsightsMetrics()` → `/api/metrics/insights`. Shows total requests, status counts (from deriveLifecycleStatus), failures 24h/7d, applies 24h/7d, destroys 24h/7d, avg/p95 apply duration (7d), apply/plan success rate (7d), cache age. All from `buildOpsMetrics(requests, generatedAt)` in `lib/observability/ops-metrics.ts`.

### Component flow (detail page)

- **Layout:** NavBar, main content; optional assistant drawer (SuggestionPanel, AssistantDrawer).
- **Detail:** Overview card (metadata, cost), Status Timeline (timeline array), StatusIndicator (canonical status), action buttons (Approve, Merge, Apply, Destroy) gated by status/role. Plan output and run links from `request.plan`, `planRun`, `applyRun`, `destroyRun`. Action progress dialog for in-flight actions.

---

## 6. Security model

### Authentication

- **Session:** Cookie `tfplan_session`. Payload: login, name, avatarUrl, email, accessToken (optional). HMAC-SHA256 signed with `AUTH_SECRET`. 12h max age.
- **OAuth:** GitHub OAuth. Start sets state cookie; callback exchanges code, fetches user/emails, checks `TFPILOT_ALLOWED_LOGINS`, sets session, redirects to `/requests`.

### Session handling

- **Read:** `getSessionFromCookies()` in API routes; `AuthProvider` in UI fetches `/api/auth/me` with credentials.
- **Write:** `setSession(res, payload)` in callback; `clearSession` on logout.
- **401:** `requireSession()` returns `NextResponse.json(UNAUTHORIZED_JSON, { status: 401 })` when no valid session.

### Admin gating

- **Roles:** `getUserRole(login)` → viewer | developer | approver | admin from `TFPILOT_ADMINS`, `TFPILOT_APPROVERS`.
- **Apply/approve:** Require approver or admin. Destroy: admin only.
- **Template admin:** `requireAdminByEmail()` using `TFPILOT_ADMIN_EMAILS` (session email).

### API protection

- **Session-required routes:** Most request/github/template/metrics/connect routes call `getSessionFromCookies()` or `requireSession()` and return 401 if missing.
- **GitHub token:** Sync, plan, apply, merge, update-branch, approve use `getGitHubAccessToken(req)`; no token → 401.
- **Prod allowlist:** `TFPILOT_PROD_ALLOWED_USERS` for plan/apply/merge/destroy in prod. `TFPILOT_DESTROY_PROD_ALLOWED_USERS` for destroy in prod.

### CSRF handling

- No explicit CSRF tokens documented. Reliance on same-origin and cookie same-site; state cookie for OAuth.

### Sensitive operations protection

- **Destroy:** Admin role + (in prod) destroy allowlist; lifecycle event logged on block.
- **Apply/merge/approve:** Session + role; prod allowlist where applicable.

### Secret usage

- **AUTH_SECRET:** Session signing.
- **GITHUB_CLIENT_SECRET:** OAuth.
- **TFPILOT_WEBHOOK_SECRET:** Drift webhooks (x-tfpilot-secret).
- **OPENAI_API_KEY:** Infra assistant (no session check on that route in code).
- Env loaded via `lib/config/env.ts`; no secrets in client bundle.

### Protected vs public endpoints (summary)

- **Protected (session):** POST/GET requests, update, approve, apply, destroy, can-destroy, audit-export, assistant/state, clarifications/respond, logs; github/plan, apply, merge, update-branch, plan-output; templates/*; modules/schema; policy; metrics; metrics/insights; connect/aws.
- **Protected (GitHub token):** sync.
- **Webhook (secret):** drift-eligible, drift-result.
- **Public/dev:** health; debug/env (404 in production).
- **Gaps (no session in code):** GET `/api/requests/[requestId]`, POST `/api/infra-assistant`, POST `/api/chat-logs`; GET modules/route, modules/[name], modules/catalog (may be intentional).

---

## 7. Observability

### Logging architecture

- **Logger:** `lib/observability/logger.ts`. Console-only; no tokens, cookies, headers, or bodies. Levels: info, warn, error.

### Logger structure

- **logInfo(event, data?), logWarn(event, error?, data?), logError(event, error?, data?).** Data: requestId, route, user, message, correlationId, duration_ms, and other keys. Error serialized as `{ name, message }`.
- **timeAsync(event, data, fn):** Runs async fn, measures duration, on success logs info with duration_ms; on failure logs error with event + "_failed" and rethrows.

### Correlation IDs

- **lib/observability/correlation.ts:** `getCorrelationId(req)` — x-correlation-id header or generated short id. `withCorrelation(req, data)` returns `{ ...data, correlationId, route }` (route = pathname). Used so logs can be tied to request and route.

### Metrics pipeline

- **Legacy:** `/api/metrics` — list 200 requests, aggregate by stored status (and complete/applied/failed/destroyed), apply durations from applyTriggeredAt/appliedAt. Session required.
- **Insights:** `/api/metrics/insights` — listRequests(1000), `buildOpsMetrics(requests, generatedAt)` uses `deriveLifecycleStatus(row)` per row, computes statusCounts, failures 24h/7d, applies 24h/7d, destroys 24h/7d, avg/p95 apply seconds (7d), apply/plan success rate (7d). 60s in-memory cache; session required.

### Ops metrics builder

- **Input:** Array of request-like rows (id, status, receivedAt, updatedAt, statusDerivedAt, applyTriggeredAt, appliedAt, planRun, applyRun, destroyRun, pr, approval).
- **Output:** total, statusCounts (canonical), failuresLast24h/7d, appliesLast24h/7d, destroysLast24h/7d, avgApplySecondsLast7d, p95ApplySecondsLast7d, applySuccessRateLast7d, planSuccessRateLast7d, generatedAt. All windows based on updatedAt/statusDerivedAt/receivedAt and applyTriggeredAt/appliedAt.

### Ops dashboard

- **UI:** Fetches `/api/metrics/insights` every 45s, displays totals, status counts, failure/apply/destroy counts, durations, success rates, cache age.

### Error capture

- **API:** try/catch in routes; logError with correlation; return 500 JSON. Lifecycle log failures only console.warn so flow continues.

### Example log payload

```json
{
  "level": "info",
  "event": "request.list",
  "timestamp": "2025-02-20T10:00:00.000Z",
  "correlationId": "a1b2c3d4e5f6g7h8",
  "route": "/api/requests",
  "duration_ms": 245
}
```

---

## 8. Reliability safeguards

### Lifecycle derivation guarantees

- **Single function:** All consumers (list, sync, metrics) use `deriveLifecycleStatus`. Same inputs → same status; no ad-hoc branches for status in handlers (except destroyRun write).
- **Idempotent derivation:** No side effects; pure function of request shape.

### Transition handling

- No transition validator in code (removed). Status changes are driven by GitHub run conclusions and PR/approval state; sync repeatedly recomputes.

### Retry behavior

- **Sync:** `ghWithRetry(token, url, 3, 300)` for GitHub API calls; retries on 5xx.
- **Merge:** On merge failure, update-branch can be run and merge retried (with backoff) when appropriate.

### Failure handling

- **Lifecycle log:** Failures in `logLifecycleEvent` are logged to console only; request flow continues.
- **Sync:** On error, 500 JSON; no partial persist. updateRequest is atomic per request.

### Destroy lifecycle safety

- **Explicit destroyRun:** Only destroy route sets `destroyRun.status = "in_progress"` and runId/url. Sync then updates conclusion/status from GitHub. No other path writes destroy state.
- **Archive:** Destroy copies request to `history/<id>.json`; active document kept with destroyRun so UI still shows destroying/destroyed until/unless pruned.

### Idempotency

- **Create:** Duplicate create (same request) can create duplicate PR/branch if not guarded by id; no request-idempotency key documented.
- **Update:** Optimistic lock prevents lost updates; no duplicate request idempotency keys.

### Concurrency protection

- **Storage:** Optimistic locking (version) on save. Concurrent updateRequest calls can get version conflict and throw.
- **GitHub:** Workflows use concurrency (e.g. per project+env+request) in workflow files; app does not enforce it beyond dispatching.

---

## 9. Operational workflows

### Plan flow

1. User triggers plan (or plan auto-dispatched on create). POST `/api/github/plan` with `requestId`.
2. Route loads request, checks session and GitHub token, prod allowlist if prod.
3. Dispatch workflow: `POST /repos/{owner}/{repo}/actions/workflows/{plan.yml}/dispatches` with ref = branchName, inputs request_id, environment.
4. Poll workflow runs for the branch to get run id/url; updateRequest with planRun (runId, url, status, headSha), timeline step.
5. GitHub Actions run plan; upload plan artifact. Sync later fetches run status and job logs, extracts plan output, updates planRun and plan.output.

### Apply flow

1. User clicks Apply. POST `/api/requests/[requestId]/apply` (or github/apply). Request must be merged (status === "merged").
2. Session + approver/admin; prod allowlist. Dispatch apply workflow with ref = base, inputs request_id, environment.
3. Poll runs for apply workflow; updateRequest with applyRun (runId, url, status: in_progress), applyTriggeredAt, timeline.
4. Sync later updates applyRun conclusion; on success can set appliedAt (if written by route). Emails on apply success/failure (sync).

### Destroy flow

1. User clicks Destroy. POST `/api/requests/[requestId]/destroy`. Session + admin; prod and destroy-prod allowlists.
2. Optionally dispatch cleanup workflow first (strip TfPilot block, open cleanup PR).
3. Dispatch destroy workflow (ref base, inputs request_id, environment).
4. Short delay then poll workflow runs for destroy run id/url. updateRequest with destroyRun: { runId, url, status: "in_progress" }, statusDerivedAt, updatedAt, cleanupPr.
5. logLifecycleEvent(destroy_dispatched). archiveRequest(updated) to history/.
6. Sync later updates destroyRun conclusion; emails on destroy success/failure.

### Approval flow

1. User approves in GitHub (or via TfPilot). POST `/api/requests/[requestId]/approve`.
2. Route posts GitHub review APPROVE, then updateRequest: timeline push "Approved", approval: { approved: true, approvers: [login] }. No status write; status comes from deriveLifecycleStatus (approval.approved → approved).

### GitHub integration

- **Auth:** Session stores accessToken; getGitHubAccessToken(req) for API. Used by sync, plan, apply, merge, update-branch, approve, destroy.
- **Workflow dispatch:** Plan, apply, destroy, cleanup workflows dispatched via Actions API. Workflow file names from env (plan.yml, apply.yml, destroy.yml, cleanup.yml).

### Workflow dispatch

- **config/workflows.ts** re-exports from env: GITHUB_PLAN_WORKFLOW_FILE, etc. Routes use env directly for dispatch URLs.

### Lifecycle logging

- **Events:** e.g. destroy_dispatched, destroy_blocked. logLifecycleEvent({ requestId, event, actor, source, data }) to S3 logs/<requestId>/<ts>.json.

---

## 10. Data and storage

### Storage backend

- **S3:** Primary. Two buckets referenced: requests bucket (requests, history, logs), chat logs bucket. Templates bucket for template storage.

### S3 structure

- **requests bucket:** `requests/<requestId>.json`, `history/<requestId>.json`, `logs/<requestId>/<timestamp>.json`.
- **Chat logs:** Separate bucket; path structure as used by chat-logs API.
- **Cost:** cost-service reads from `cost/<requestId>/` (infracost JSON); not in requests bucket necessarily (implementation in cost-service).

### Logs storage

- **Lifecycle:** Same bucket as requests; prefix `logs/<requestId>/`. One object per event; key includes ISO timestamp.

### Metrics data sources

- **Legacy metrics:** listRequests(200) from S3; stored status and applyTriggeredAt/appliedAt.
- **Ops metrics:** listRequests(1000) from S3; deriveLifecycleStatus per row and time windows.

### Retention patterns

- No automatic retention or TTL documented in code. Objects remain until explicitly deleted or overwritten.

### Data consistency guarantees

- **Single request:** Optimistic locking on write; read-your-writes after updateRequest/saveRequest.
- **List:** Eventually consistent with S3 list + get; no strong consistency across list items. Status in list response is derived at read time.

---

## 11. Metrics and monitoring

### /api/metrics

- **Auth:** Session required.
- **Data:** listRequests(200). Aggregates: total, statusCounts (by stored status), successCount (complete/applied), failureCount, destroyedCount, avgApplySeconds (from applyTriggeredAt/appliedAt), successRate = successCount/total.
- **Response:** `{ success: true, metrics: { total, statusCounts, successRate, failureCount, destroyedCount, avgApplySeconds } }`.

### /api/metrics/insights

- **Auth:** Session required.
- **Data:** listRequests(1000), buildOpsMetrics(requests, generatedAt). Status from deriveLifecycleStatus per row.
- **Cache:** In-memory, TTL 60s. Response includes cacheAgeSeconds when served from cache.
- **Response:** success, metrics (OpsMetricsPayload: total, statusCounts, failuresLast24h/7d, appliesLast24h/7d, destroysLast24h/7d, avgApplySecondsLast7d, p95ApplySecondsLast7d, applySuccessRateLast7d, planSuccessRateLast7d, generatedAt, cacheAgeSeconds).

### Metrics derivation

- **Insights:** All status-based counts and rates use the same deriveLifecycleStatus so metrics align with list/detail UI.

### Cache strategy

- **Insights only:** Single in-memory cache, 60s TTL. No distributed cache.

### KPIs (insights)

- Total requests (capped list), status distribution, failures 24h/7d, applies 24h/7d, destroys 24h/7d, avg/p95 apply duration (7d), apply success rate (7d), plan success rate (7d).

---

## 12. Scalability considerations

### Bottlenecks

- **List:** listRequests(limit) does S3 ListObjectsV2 then one GetObject per key. Latency and cost grow with limit (e.g. 1000 for insights).
- **Sync:** One sync does many GitHub API calls (PR, reviews, runs for plan/apply/destroy). Sequential per request.
- **Single process:** No horizontal scaling of app process documented; single Next.js instance.

### Single points of failure

- **S3:** All request and lifecycle state in one bucket/region.
- **GitHub:** All run state and PR data from GitHub; outage affects sync and actions.
- **App:** One deployment; no multi-region or failover described.

### S3 scan patterns

- **List:** Prefix `requests/`, max keys limit. No partition key; all requests under one prefix. List then N gets.

### API scaling

- Stateless API; can scale horizontally behind a load balancer if infrastructure allows. No in-memory state except insights cache (per instance).

### Polling load

- **Detail:** Each open detail page polls sync every 3s until terminal. N open details → N sync calls every 3s.
- **Insights:** One client polls insights every 45s. Low.

### GitHub rate limits

- No explicit rate limiting in app code. Relies on GitHub’s limits; retries and backoff in ghWithRetry (3 attempts, 300ms base delay).

### Caching strategy

- **Request data:** No HTTP cache headers on request/sync responses. SWR dedupingInterval 2s reduces duplicate sync calls per key.
- **Insights metrics:** 60s in-memory cache per instance.

---

## 13. Code organization

### Folder structure

- **app/** — App Router: api/ (routes), requests/, login/, catalogue/, insights/, aws/, environments/, layout, providers, theme.
- **lib/** — Core logic: auth, config, github, infra, logs, observability, plan, requests, status, storage, services, notifications, assistant, agent, data.
- **config/** — workflow names, module-registry, infra-repos, request-templates, network-presets.
- **components/** — ui/ (shadcn), status, assistant-drawer, suggestion-panel, action-progress-dialog.
- **hooks/** — use-request-status, (useInsightsMetrics in lib/observability).
- **scripts/** — validate-module-registry, validate-names, validate-server-tags.
- **types/** — diff3, swr.
- **utils/** — assistantNormalize, (lib/utils).

### Domain separation

- **requests:** id, naming, tags, deriveLifecycleStatus (lifecycle); storage in requestsStore.
- **status:** status-config (canonical statuses, labels, colors, normalizeRequestStatus); single source for UI display.
- **github:** auth, client, updateBranch (merge/update-branch logic).
- **observability:** logger, correlation, ops-metrics, useInsightsMetrics.
- **logs:** lifecycle (S3 lifecycle event writes).
- **auth:** session, roles, admin.

### Shared utilities

- **lib/utils.ts:** cn() (classnames). Used across UI.
- **config/module-registry:** Module types, fields, validation; used by API and UI.
- **config/infra-repos:** Project/environment → owner, repo, base, envPath.

### Type organization

- **CanonicalStatus, StatusMeta:** lib/status/status-config.ts.
- **RequestLike (for derivation):** lib/requests/deriveLifecycleStatus.ts.
- **Stored request shape:** Defined in route handlers and storage layer; no single shared request type file.

### Status config role

- **lib/status/status-config.ts:** Defines CANONICAL_STATUSES, getStatusMeta, getStatusLabel, getStatusColor, isActiveStatus, isTerminalStatus, normalizeRequestStatus. Single source for labels and normalization for list/detail/timeline.

---

## 14. Known technical debt

### Deprecated paths

- **Refresh endpoint:** Removed; sync is the only refresh path. Docs updated.
- **deriveStatus / getDisplayStatusLabel:** Removed from lib/requests/status.ts; status-config is the only label source. RequestStatus type removed; table uses string for status.

### Legacy stubs

- **PLATFORM_REVIEW_FOR_AGENT.md** still mentions "deriveStatus()" and "getDisplayStatusLabel()" in one sentence (status derivation); implementation now uses deriveLifecycleStatus and getStatusLabel from status-config.

### TODOs

- **proxy.ts:** Removed; was unused (no custom server). No remaining proxy TODOs.
- **docs:** Some references to "refresh" or old status utilities may remain in other docs.

### Simplifications

- Lifecycle Model V2 completed: single derivation, no explicit status writes except destroyRun. Reason no longer persisted from sync.

### Remaining cleanup areas

- **GET /api/requests/[requestId]:** No session check; documented as a security gap.
- **POST /api/infra-assistant, POST /api/chat-logs:** No session check; documented.
- **Modules/catalog routes:** No auth; may be intentional.
- **Lint:** Many no-explicit-any and unused-variable fixes remain; not behavioral debt but code quality.

---

## 15. Strengths and weaknesses (internal view)

### Strengths

- **Single lifecycle derivation:** One function (deriveLifecycleStatus) for list, sync, and metrics; consistent status everywhere.
- **Clear status display contract:** status-config is the single source for labels and normalization; no duplicate label logic.
- **Lifecycle logging:** Structured events to S3 with requestId, event, actor, source, data; audit trail without blocking flow.
- **Optimistic locking:** Prevents lost updates on concurrent request updates.
- **Explicit destroy lifecycle:** destroyRun is the only explicit lifecycle write besides sync’s full derivation; easy to reason about.
- **Insights metrics aligned with derivation:** buildOpsMetrics uses same deriveLifecycleStatus; KPIs match UI.
- **Correlation and timing:** withCorrelation and timeAsync used across routes for traceability and duration.
- **Modular API:** Routes are focused; storage and GitHub behind lib; config (env, registry, infra-repos) centralized.

### Weaknesses

- **List scalability:** List + N GetObject; no indexing or partition strategy; insights caps at 1000.
- **No request-level idempotency:** Create and some mutations could be retried and create duplicates.
- **Auth gaps:** GET request by id, infra-assistant, chat-logs, and possibly modules unprotected in code.
- **Single-region S3:** No multi-region or replication described.
- **Polling load:** Many open detail pages multiply sync calls; no server push or long polling.
- **Loose typing:** Many `any` and optional fields; no single shared request type across routes.
- **No formal API spec:** Contracts are implicit (types and handlers).

---

## 16. File map

| Path | Purpose |
|------|---------|
| **lib/requests/deriveLifecycleStatus.ts** | Single lifecycle derivation; exports deriveLifecycleStatus, RequestLike. |
| **lib/requests/id.ts** | generateRequestId. |
| **lib/requests/naming.ts** | buildResourceName, validateResourceName (naming policy). |
| **lib/requests/tags.ts** | injectServerAuthoritativeTags, assertRequiredTagsPresent. |
| **lib/status/status-config.ts** | Canonical statuses, getStatusLabel, getStatusColor, normalizeRequestStatus, isActiveStatus, isTerminalStatus. |
| **lib/observability/logger.ts** | logInfo, logWarn, logError, timeAsync. |
| **lib/observability/correlation.ts** | getCorrelationId, withCorrelation. |
| **lib/observability/ops-metrics.ts** | buildOpsMetrics, OpsMetricsPayload, RequestRow. |
| **lib/observability/useInsightsMetrics.ts** | useInsightsMetrics hook (SWR on /api/metrics/insights). |
| **lib/storage/requestsStore.ts** | getRequest, saveRequest, updateRequest, listRequests, archiveRequest. |
| **lib/logs/lifecycle.ts** | logLifecycleEvent (S3 logs/<requestId>/<ts>.json). |
| **lib/auth/session.ts** | getSessionFromCookies, requireSession, setSession, decodeSessionToken, UNAUTHORIZED_JSON. |
| **lib/auth/roles.ts** | getUserRole (viewer/developer/approver/admin). |
| **lib/auth/admin.ts** | requireAdminByEmail (template admin). |
| **lib/config/env.ts** | env (all TFPILOT_*, GITHUB_*, AUTH_SECRET, etc.). |
| **app/api/requests/route.ts** | POST create (branch, PR, plan dispatch), GET list (deriveLifecycleStatus per request). |
| **app/api/requests/[requestId]/sync/route.ts** | GET sync: hydrate from GitHub, derive status, updateRequest, emails, timeline. |
| **app/api/requests/[requestId]/approve/route.ts** | POST approve (GitHub review + timeline). |
| **app/api/requests/[requestId]/apply/route.ts** | POST apply dispatch, record applyRun. |
| **app/api/requests/[requestId]/destroy/route.ts** | POST cleanup + destroy dispatch, set destroyRun, archive. |
| **app/api/github/plan/route.ts** | POST plan dispatch. |
| **app/api/github/apply/route.ts** | POST apply dispatch. |
| **app/api/github/merge/route.ts** | POST merge PR (optional update-branch retry). |
| **app/api/metrics/route.ts** | GET legacy metrics (list 200). |
| **app/api/metrics/insights/route.ts** | GET insights metrics (list 1000, buildOpsMetrics, 60s cache). |
| **hooks/use-request-status.ts** | useRequestStatus(requestId, initial) — SWR on sync, 3s poll when non-terminal. |
| **app/insights/InsightsDashboard.tsx** | Insights dashboard UI; useInsightsMetrics, StatCards, status counts table. |
| **app/requests/page.tsx** | Requests list; filters, StatusIndicator, normalizeRequestStatus, getStatusLabel. |
| **app/requests/[requestId]/page.tsx** | Request detail; useRequestStatus, timeline, actions, StatusIndicator, plan diff. |
| **components/status/StatusIndicator.tsx** | Status badge/label from status-config. |

---

## 17. Example flows (step-by-step with status)

### Create request

1. POST `/api/requests` with project, environment, module, config.
2. Validate payload; resolve infra repo; normalize config (module registry); generate requestId; saveRequest (status not set by create handler; may default or be set in save).
3. Create branch `request/<requestId>`, commit Terraform block, open PR, dispatch plan workflow.
4. Poll for plan run; updateRequest with planRun (runId, url, status), timeline.
5. **Status:** After sync: planning → plan_ready when plan succeeds; list and detail show derived status.

### Plan

1. Plan already dispatched on create (or POST /api/github/plan).
2. GitHub Actions run plan; upload artifact. Sync fetches run conclusion and job logs, updates planRun and plan.output.
3. **Status:** planning (running) → plan_ready (success) or failed (failure).

### Approve

1. User approves in GitHub (or UI calls POST approve). POST `/api/requests/[requestId]/approve`.
2. Route posts GitHub review APPROVE; updateRequest: timeline "Approved", approval: { approved: true, approvers: [login] }.
3. **Status:** deriveLifecycleStatus sees approval.approved → approved. No status write in approve handler.

### Merge

1. User merges PR (or POST /api/github/merge). Merge API merges PR; optionally runs update-branch on conflict.
2. Sync fetches PR; pr.merged = true. Derivation → merged.
3. **Status:** approved → merged (after sync).

### Apply

1. POST `/api/requests/[requestId]/apply`. Request must be merged. Dispatch apply workflow; updateRequest with applyRun (runId, url, status: in_progress), applyTriggeredAt, timeline.
2. GitHub Actions run apply. Sync updates applyRun conclusion; emails on success/failure.
3. **Status:** merged → applying → applied (success) or failed (failure).

### Destroy

1. POST `/api/requests/[requestId]/destroy`. Dispatch cleanup (optional) then destroy. updateRequest with destroyRun: { runId, url, status: "in_progress" }. archiveRequest to history/.
2. Sync updates destroyRun from GitHub runs.
3. **Status:** applied (or other) → destroying → destroyed (success) or failed (failure).

---

*End of architecture review. No recommendations or code changes; documentation of current state only.*
