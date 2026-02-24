# TfPilot Platform Full Audit Report

**Document type:** Technical audit (assessment only — no change proposals)  
**Scope:** TfPilot codebase (Next.js App Router, S3, GitHub integration)  
**Grounding:** Code references and file paths from the repository.

---

## 1️⃣ Executive Summary

**What the platform is:** TfPilot is a Terraform self-service control plane that turns user requests into deterministic Terraform changes. It persists requests in S3, generates bounded Terraform blocks in infra repos, opens GitHub PRs, and orchestrates plan/apply/destroy via GitHub Actions. The app does not run Terraform; GitHub is the execution boundary.

**Primary responsibilities:** (1) Auth and session; (2) request CRUD and lifecycle derivation; (3) S3 request + lifecycle log storage; (4) GitHub PR creation, workflow dispatch, and run/PR inspection; (5) UI timeline and actions; (6) optional drift detection and cost estimation.

**Architecture style:** Internal platform / orchestration engine. Single Next.js app as control plane; no separate worker service. Execution is delegated to GitHub Actions; state is in S3 and GitHub (PRs, runs).

**Overall maturity level:** **MVP / early production-ready.** Core flows (create → plan → approve → merge → apply → destroy) are implemented with optimistic locking, idempotency on key mutations, and a canonical lifecycle model. Gaps: locking not on all mutation routes, create idempotency in-memory only, list is unbounded S3 scan, no global rate limiting, observability is console + optional insights.

**Key strengths:** Clear lifecycle derivation (single pure function), rate-aware GitHub GET wrapper with cache and backoff, optimistic versioning on S3, env-configurable polling, role-based prod guardrails, lifecycle events to S3 for audit.

**Key risks:** S3 list scalability; create idempotency store is process-local; approve/merge lack request locking; `/api/health` is public; debug route exposes config in non-prod; dependency on GitHub API availability and rate limits.

---

## 2️⃣ System Architecture

**High-level flow:** User → Next.js UI → API routes (session-validated) → S3 (requests, logs) and GitHub API (PRs, workflow dispatch, runs). Sync endpoint hydrates request from GitHub (PR, reviews, workflow runs) and persists derived status. UI polls list and per-request sync/logs with SWR; intervals are adaptive (active/idle/hidden/429).

**Control plane boundaries:** The app is the only control plane. It does not execute Terraform; it triggers workflows and reads back run/PR state. Infra repos hold Terraform and workflows; TfPilot writes only between `tfpilot:begin/<id>` and `tfpilot:end/<id>` markers.

**Major components and key files:**

| Component | Purpose | Key files |
|-----------|---------|-----------|
| **API layer** | Next.js App Router route handlers; session or admin checks per route | `app/api/**/route.ts` |
| **Lifecycle engine** | Derive canonical status from request facts; single source of truth | `lib/requests/deriveLifecycleStatus.ts`, `lib/status/status-config.ts` |
| **GitHub orchestration** | Token from session, `gh()` for writes, `githubRequest()` (rateAware) for GETs; workflow dispatch | `lib/github/auth.ts`, `lib/github/client.ts`, `lib/github/rateAware.ts`, `app/api/github/*.ts` |
| **Request storage** | S3 requests bucket; optimistic locking; list/get/update/archive | `lib/storage/requestsStore.ts` |
| **Polling + sync** | Sync hydrates from GitHub and persists status; UI uses SWR + adaptive intervals | `lib/config/polling.ts`, `hooks/use-request-status.ts`, `app/api/requests/[requestId]/sync/route.ts` |
| **UI → API** | List: GET `/api/requests`; detail: GET `/api/requests/[id]`, sync, logs; actions: POST to apply/merge/approve/destroy/update | `app/requests/page.tsx`, `app/requests/[requestId]/page.tsx` |
| **Observability** | Structured logger, correlation IDs, lifecycle events to S3, ops metrics from capped list | `lib/observability/logger.ts`, `lib/observability/correlation.ts`, `lib/logs/lifecycle.ts`, `lib/observability/ops-metrics.ts`, `app/api/metrics/insights/route.ts` |

---

## 3️⃣ Request Lifecycle Engine

**How status is derived:** Status is a **pure function** of the request document: `deriveLifecycleStatus(request)` in `lib/requests/deriveLifecycleStatus.ts`. It is used by the list route (per request), sync route (persist after hydration), GET request route (response only), and ops metrics. No separate state machine; the canonical state is derived from `pr`, `planRun`, `applyRun`, `approval`, `destroyRun`, and `mergedSha`.

**Canonical status model:** Defined in `lib/status/status-config.ts`: `request_created` → `planning` → `plan_ready` → `approved` → `merged` → `applying` → `applied` (terminal); or `destroying` → `destroyed` (terminal); or `failed` (terminal). Legacy/API variants are normalized for display via `normalizeRequestStatus()`.

**deriveLifecycleStatus logic (priority order):** Destroy (in_progress/queued → destroying; completed success → destroyed; completed failure → failed) → apply failure → plan failure → apply running → apply success → merged (pr.merged or mergedSha) → approved → plan success → plan running / PR open → default `request_created`.

**Lifecycle logs usage:** `logLifecycleEvent({ requestId, event, actor?, source?, data? })` in `lib/logs/lifecycle.ts` writes to S3 `logs/<requestId>/<timestamp>.json` in the same bucket. Used for audit/timeline only; it does not drive status. Events include: `request_created`, `plan_dispatched`, `configuration_updated`, `request_approved`, `pr_merged`, `apply_dispatched`, `destroy_dispatched`, `destroy_blocked`, `drift_check_started`, `drift_detected`, `drift_cleared`. Failures are logged to console only so they do not break the flow.

**Sync flow:** GET `app/api/requests/[requestId]/sync/route.ts`. Loads request from S3; requires session and GitHub token. Fetches PR, reviews, cleanup PR, plan/apply/destroy runs (and plan logs) via `githubRequest()`; applies apply-run head-SHA validation to avoid cross-request contamination; calls `deriveLifecycleStatus(request)`, sets `request.status`, `statusDerivedAt`, `updatedAt`; appends cleanup PR timeline steps; sends email on apply/destroy/plan conclusion transitions; persists via `updateRequest(requestId, mutate)`.

**Status persistence:** Sync is the only place that **persists** derived status (and related fields) to S3. List and GET request derive status for the response only.

**Timeline behavior:** Timeline steps are partly derived from request state (e.g. plan run, apply run, cleanup PR) and partly from lifecycle log events (e.g. for timestamps). Detail page fetches `/api/requests/[requestId]/logs` (S3 list + get of `logs/<requestId>/*.json`).

**Files involved:**  
`lib/requests/deriveLifecycleStatus.ts`, `lib/status/status-config.ts`, `lib/logs/lifecycle.ts`, `app/api/requests/[requestId]/sync/route.ts`, `app/api/requests/route.ts` (GET list), `app/api/requests/[requestId]/route.ts` (GET one), `app/api/requests/[requestId]/logs/route.ts`, `lib/observability/ops-metrics.ts`.

**Code snippets:**

**deriveLifecycleStatus (excerpt):**
```ts
// lib/requests/deriveLifecycleStatus.ts (priority order)
if (destroyRun?.status === "in_progress" || destroyRun?.status === "queued") return "destroying"
if (destroyRun?.status === "completed" && destroyRun.conclusion === "success") return "destroyed"
// ... apply/plan failure, apply running, apply success, merged, approved, plan_ready, planning, pr.open
return "request_created"
```

**Sync route status update:**
```ts
// app/api/requests/[requestId]/sync/route.ts
const status = deriveLifecycleStatus(request)
request.status = status
request.statusDerivedAt = nowIso
request.updatedAt = nowIso
// ...
const updated = await updateRequest(requestId, (current) => ({
  ...current,
  status: request.status,
  statusDerivedAt: request.statusDerivedAt,
  updatedAt: request.updatedAt,
  // ... pr, planRun, applyRun, approval, cleanupPr, timeline, plan, destroyRun
}))
```

**List route status derivation:**
```ts
// app/api/requests/route.ts GET
const raw: StoredRequest[] = (await listRequests()) as StoredRequest[]
const requests = raw.map((req) => ({
  ...req,
  status: deriveLifecycleStatus(req),
}))
return NextResponse.json({ success: true, requests })
```

---

## 4️⃣ Reliability Primitives

| Primitive | Present | Implementation | Files | Snippet / notes |
|-----------|--------|----------------|-------|------------------|
| **Idempotency** | Yes (partial) | Header `x-idempotency-key`; per-operation window (10 min); replay returns stored response; create uses in-memory Map | `lib/requests/idempotency.ts`; used in apply, merge, plan, approve, update, destroy, create | Create: `checkCreateIdempotency` / `recordCreate` (in-memory; not shared across instances). Mutations: `assertIdempotentOrRecord` with patch persisted to request doc. |
| **Request locking** | Yes (partial) | TTL 2 min; holder + operation; acquire returns patch or null; release clears if holder matches. **Not used on approve or merge.** | `lib/requests/lock.ts`; used in apply, plan, update, destroy | `acquireLock` / `releaseLock` in `app/api/github/apply/route.ts`, `app/api/github/plan/route.ts`, `app/api/requests/[requestId]/destroy/route.ts`, `app/api/requests/update/route.ts`. Approve and merge: idempotency only. |
| **Retry/backoff** | Yes (GitHub) | In `githubRequest`: 403/429 with remaining=0 → wait until reset (cap 30s dev / 60s prod); retry-after header; 5xx exponential 1s, 2s, 4s (max 3 retries) | `lib/github/rateAware.ts` | Only for GETs through `githubRequest`. POST/dispatch use raw `gh()` — no retry. |
| **Rate limiting** | Partial | Drift-eligible route: per-IP in-memory (30/min). No app-wide API rate limiting. GitHub side: rate-aware wrapper. | `app/api/requests/drift-eligible/route.ts` | `checkRateLimit(ip)`; no Redis; per-instance. |
| **Concurrency protection** | Yes (partial) | Optimistic locking on S3 via `version`; `updateRequest` read-modify-write with expectedVersion. Lock on apply/plan/update/destroy only. | `lib/storage/requestsStore.ts`, `lib/requests/lock.ts` | `saveRequest(request, { expectedVersion })`; conflict throws. |
| **Terminal state handling** | Yes | deriveLifecycleStatus returns terminal statuses (applied, destroyed, failed). UI polling returns 0 interval for terminal so polling stops. | `lib/status/status-config.ts` (`isTerminalStatus`), `lib/config/polling.ts`, `hooks/use-request-status.ts` | `getSyncPollingInterval(request, tabHidden)` → 0 when terminal. |

---

## 5️⃣ GitHub Integration Model

**Auth:** OAuth 2.0 (GitHub OAuth App). User hits `/api/auth/github/start`, redirects to GitHub; callback `/api/auth/github/callback` exchanges code for access token, fetches user (and emails) via `githubRequest`, stores session with `setSession` (cookie: login, name, avatarUrl, email, accessToken). No GitHub App installation flow in code; token is user-bound.  
Files: `app/api/auth/github/start/route.ts`, `app/api/auth/github/callback/route.ts`, `lib/auth/session.ts`, `lib/github/auth.ts`.

**Token lifecycle:** Token is in session cookie (server-side decode only; not logged). `getGitHubAccessToken(req)` reads session from cookies and returns `session?.accessToken`. No server-side refresh; session expires (e.g. 12h).

**Rate-aware wrapper:** `lib/github/rateAware.ts` — `githubRequest(opts)` for GET (and HEAD). In-memory cache (key, TTL ms, optional etag); cache hit returns without calling API. On 403/429 with `x-ratelimit-remaining=0`, waits until `x-ratelimit-reset` (capped); respects `retry-after`; 5xx exponential backoff. Logs: `github.cache_hit`, `github.retry`, `github.rate_limited`. **Not used for POST/PATCH** (workflow dispatch, merge, etc.) — those use `gh()` in `lib/github/client.ts` with no cache and no retry.

**Caching model:** Per-call TTL (e.g. PR 30s, runs 15s, single run 10s, logs 0). Max 500 entries; FIFO eviction. Key is caller-defined (e.g. `gh:pr:owner:repo:prNum`).

**Retry behavior:** As above; only inside `githubRequest`. Raw `gh()` throws on non-2xx.

**Workflow dispatch:** POST to `/repos/:owner/:repo/actions/workflows/:file/dispatches` with `ref` and `inputs` (e.g. request_id, environment). Used for plan (on create and re-plan), apply, destroy, cleanup. Concurrency is enforced by GitHub workflow `concurrency` group (per project/env/request) configured in repo workflows, not in app code.

**PR + run inspection:** Sync and other routes use `githubRequest` to GET: pulls/:num, pulls/:num/reviews, workflow runs by branch, actions/runs/:runId, jobs, job logs. Apply run is validated by head SHA matching request’s mergedSha/commitSha/planRun.headSha to avoid attaching another request’s run.

**Endpoints that call GitHub:**  
- `app/api/auth/github/callback/route.ts` — user, user/emails (rateAware).  
- `app/api/requests/[requestId]/sync/route.ts` — PR, reviews, cleanup PR, workflow runs, run, jobs, logs (rateAware).  
- `app/api/github/plan/route.ts` — workflow dispatch (gh), pulls, runs (rateAware).  
- `app/api/github/apply/route.ts` — workflow dispatch (gh), runs (rateAware).  
- `app/api/github/merge/route.ts` — merge (gh), pulls (rateAware).  
- `app/api/github/update-branch/route.ts` — merge/update (gh).  
- `app/api/github/plan-output/route.ts`, `app/api/github/apply-output/route.ts`, `app/api/github/pr-diff/route.ts`, `app/api/github/approval-status/route.ts` — GETs (rateAware where used).  
- `app/api/requests/route.ts` (POST create) — branch, commit, PR, workflow dispatch (gh), runs (rateAware).  
- `app/api/requests/update/route.ts` — file fetch, branch update, workflow dispatch (gh), runs (rateAware).  
- `app/api/requests/[requestId]/destroy/route.ts` — workflow dispatch (gh), runs (rateAware).

**Snippet (rateAware):**
```ts
// lib/github/rateAware.ts
if (ttlMs > 0) {
  const cached = getFromCache<T>(key)
  if (cached) {
    logInfo("github.cache_hit", logData({ key }))
    return cached.value
  }
}
// ... doFetch; on 403/429 remaining=0 wait until reset (cap 30s/60s); retry-after; 5xx backoff 1s,2s,4s
```

---

## 6️⃣ API Surface Review

**Grouping by domain:**

**Requests**
- `POST /api/requests` — Create request; session; viewer rejected; create idempotency (in-memory); prod allowlist; writes S3 + GitHub (branch, PR, plan dispatch).  
- `GET /api/requests` — List; session; derives status per request; no pagination (listRequests(50)).  
- `GET /api/requests/[requestId]` — One request; session; status derived for response only.  
- `GET /api/requests/[requestId]/sync` — Hydrate from GitHub, persist status; session + token.  
- `POST /api/requests/update` — Config update, optional re-plan; session; idempotency + lock.  
- `POST /api/requests/[requestId]/approve` — Record approval in doc; session; idempotency; **no lock**.  
- `GET /api/requests/[requestId]/logs` — Lifecycle events from S3; session.  
- `GET /api/requests/[requestId]/can-destroy`, `GET /api/requests/[requestId]/drift-result`, `GET /api/requests/[requestId]/audit-export`, `GET /api/requests/[requestId]/assistant/state` — session.  
- `POST /api/requests/[requestId]/clarifications/respond` — session.  
- `GET /api/requests/drift-eligible` — **No session**; webhook secret `x-tfpilot-secret` + IP rate limit.

**Lifecycle / GitHub actions**
- `POST /api/github/plan` — Dispatch plan workflow; session; idempotency + lock.  
- `POST /api/github/merge` — Merge PR; session; idempotency; **no lock**.  
- `POST /api/github/apply` — Dispatch apply workflow; session; approver/admin; idempotency + lock.  
- `POST /api/requests/[requestId]/destroy` — Dispatch destroy; session; idempotency + lock.  
- `GET /api/github/plan-output`, `GET /api/github/apply-output`, `GET /api/github/pr-diff`, `GET /api/github/approval-status`, `POST /api/github/update-branch` — session (or session + token).

**Metrics**
- `GET /api/metrics/insights` — Ops metrics from listRequests(1000); session; 60s in-memory cache.  
- `GET /api/metrics` — Simpler metrics from listRequests(200); session.

**Modules**
- `GET /api/modules`, `GET /api/modules/catalog`, `GET /api/modules/schema`, `GET /api/modules/[name]` — session.

**Auth**
- `GET /api/auth/github/start` — Redirect to GitHub (no session required).  
- `GET /api/auth/github/callback` — OAuth callback (no session yet).  
- `GET /api/auth/me`, `POST /api/auth/logout` — Session.

**Templates**
- `GET/POST /api/templates`, `GET/POST /api/templates/[id]` — session.  
- `GET/POST/DELETE /api/templates/admin/*`, `POST /api/templates/admin/seed` — `requireAdminByEmail` (TFPILOT_ADMIN_EMAILS).

**Infra / other**
- `GET /api/infra/health` — Session required (project/env query).  
- `GET /api/health` — **No session**; returns `{ status: "ok" }` (public liveness).  
- `GET /api/debug/env` — **No session**; 404 in production; in dev returns workflow/config (no secrets in snippet but env object imported).  
- `GET /api/policy`, `POST /api/connect/aws`, `POST /api/infra-assistant`, `GET /api/chat-logs` — session.

**Endpoints without session protection:**  
- `GET /api/health` — public.  
- `GET /api/requests/drift-eligible` — protected by webhook secret + rate limit only.  
- OAuth: start/callback — intentional.

---

## 7️⃣ Data Model & Persistence

**Request document (conceptual schema):** Stored as JSON in S3 `requests/<requestId>.json`. Core fields: `id`, `project`, `environment`, `module`, `config`, `receivedAt`, `updatedAt`, `version` (optimistic lock), `status`, `statusDerivedAt`; PR: `pr`, `prNumber`, `prUrl`, `branchName`, `commitSha`, `mergedSha`, `targetOwner`, `targetRepo`, `targetBase`, `targetEnvPath`, `targetFiles`; runs: `planRun`, `applyRun`, `destroyRun`; `approval`; `plan` (e.g. output); `cleanupPr`; `timeline` (array of steps); `idempotency` (per-operation `{ key, at }`); `lock` (`holder`, `operation`, `acquiredAt`, `expiresAt`); optional `cost`, `templateId`, `environmentName`, assistant state, etc.

**S3 storage pattern:** One object per request; prefix `requests/`. Archive: `history/<requestId>.json`. Lifecycle logs: `logs/<requestId>/<timestamp>.json`. Cost: `cost/<requestId>/` (infracost; not in request body). SSE (AES256) on write.

**Idempotency storage:** In request doc: `idempotency: Record<operation, { key, at }>`. Create idempotency: in-memory Map (requestId, at, requestDoc) with 10-min prune; not shared across processes.

**Lock storage:** In request doc: `lock: { holder, operation, acquiredAt, expiresAt }`. TTL 2 min; cleared by releaseLock (patch `lock: undefined`).

**Timeline storage:** Array on request doc; sync appends cleanup PR steps. Lifecycle events are separate objects in `logs/`.

**Schema cleanliness:** Single JSON document with many optional and legacy-duplicate fields (e.g. `prNumber`/`pr`, `pullRequest`). No formal schema or migration version in code; additive evolution. TypeScript types are local to routes (e.g. StoredRequest in requests/route.ts) rather than a single shared request type.

---

## 8️⃣ Polling & Sync Behavior

**Table polling:** `app/requests/page.tsx` uses SWR with key `/api/requests`, `refreshInterval: 30_000` ms, revalidateOnFocus/reconnect, keepPreviousData. No adaptive interval for list.

**Detail polling:** `hooks/use-request-status.ts` uses SWR with key `/api/requests/${requestId}/sync?nonce=${nonce}`. `refreshInterval` is `getSyncPollingInterval(latest, tabHidden)`: terminal → 0 (stop); tab hidden → SYNC_INTERVAL_HIDDEN_MS (default 60s); active status → SYNC_INTERVAL_ACTIVE_MS (default 3s); else SYNC_INTERVAL_IDLE_MS (default 10s). On 429, interval forced to SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS (default 60s) until success. Deduping 2s; retry with exponential backoff (max 8 retries, 429 up to 5).

**Adaptive intervals / backoff:** Defined in `lib/config/polling.ts`; env: `NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_ACTIVE_MS`, `_IDLE_MS`, `_HIDDEN_MS`, `_RATE_LIMIT_BACKOFF_MS`. Detail page logs SWR uses same `getSyncPollingInterval` for `refreshInterval`.

**GitHub call frequency:** Driven by sync and other GETs; each sync does multiple GitHub GETs (PR, reviews, cleanup PR, runs, run details, logs). Caching (30s/15s/10s/0) reduces calls; many open detail tabs = many sync requests per interval.

**Caching impact:** rateAware cache reduces GitHub API calls for repeated GETs within TTL; list route does not use rateAware (no GitHub in list). Insights metrics cache 60s in-memory.

**Files:** `lib/config/polling.ts`, `hooks/use-request-status.ts`, `app/requests/page.tsx`, `app/requests/[requestId]/page.tsx` (logs refreshInterval).

---

## 9️⃣ Observability & Metrics

**Logger:** `lib/observability/logger.ts` — `logInfo`, `logWarn`, `logError` (event string + optional error + data). Output is JSON to console (no tokens, cookies, headers, or bodies). `timeAsync(event, data, fn)` measures duration and logs on success/failure.

**Correlation IDs:** `lib/observability/correlation.ts` — `getCorrelationId(req)` from `x-correlation-id` or generated; `withCorrelation(req, data)` adds correlationId and route to data. Used in request/create, sync, apply, plan, infra-assistant, chat-logs for log context.

**Ops metrics endpoint:** `GET /api/metrics/insights` uses `buildOpsMetrics(requests, generatedAt)` from `lib/observability/ops-metrics.ts`. Input: capped list (1000). Output: total, statusCounts (by deriveLifecycleStatus), failuresLast24h/7d, appliesLast24h/7d, destroysLast24h/7d, avgApplySecondsLast7d, p95ApplySecondsLast7d, applySuccessRateLast7d, planSuccessRateLast7d, generatedAt, cacheAgeSeconds. Session required; 60s cache.

**Dashboard:** UI at insights page consuming `/api/metrics/insights` (and useInsightsMetrics); no separate ops dashboard service.

**Log safety:** Logger explicitly avoids tokens, cookies, headers, request bodies. Auth callback had console.log with redacted flags (e.g. has_access_token); not the structured logger.

**Event coverage:** Lifecycle events written via `logLifecycleEvent` (see §3). Logger events include e.g. `request.create`, `request.create_failed`, `idempotency.replay`, `idempotency.conflict`, `auth.unauthorized`, `github.cache_hit`, `github.retry`, `github.rate_limited`, `request.list`, `request.read`, etc.

---

## 🔟 Security Posture

**Auth model:** Cookie-based session (HMAC-signed payload: login, name, avatarUrl, email, accessToken). Session from `getSessionFromCookies`; protected routes use `requireSession()` (401 JSON) or explicit `getSessionFromCookies()` then 401 if null. Roles: viewer, developer, approver, admin via `getUserRole(login)` from env lists (TFPILOT_ADMINS, TFPILOT_APPROVERS).

**Session enforcement:** Per-route; no global middleware. Every API route under review either calls requireSession/getSessionFromCookies or requireAdminByEmail, except `/api/health`, OAuth start/callback, and `/api/requests/drift-eligible` (webhook secret).

**Public endpoints:** `GET /api/health` — no auth; returns liveness only.

**Secret exposure risks:** Env holds GITHUB_CLIENT_ID/SECRET, AUTH_SECRET, OPENAI_API_KEY, etc. `GET /api/debug/env` returns partial config in dev only (404 in prod); response does not include raw secrets in the snippet but imports full env. Auth callback previously logged redacted flags; no secrets in structured logger payloads.

**Webhook protection:** `/api/requests/drift-eligible` requires header `x-tfpilot-secret`; constant-time compare against TFPILOT_WEBHOOK_SECRET; plus per-IP rate limit.

**Admin protections:** Template admin routes use `requireAdminByEmail()` (TFPILOT_ADMIN_EMAILS); returns 404 for non-admins. Prod actions (merge/apply/destroy) gated by TFPILOT_PROD_ALLOWED_USERS (and destroy by TFPILOT_DESTROY_PROD_ALLOWED_USERS where used).

**Gaps:** Approve and merge have no request lock (only idempotency when client sends key). Create idempotency is in-memory (replay lost across restarts/instances). No CSRF tokens documented for state-changing POSTs (rely on same-origin + cookie).

---

## 11️⃣ Scalability Characteristics

**Request listing:** `listRequests(limit)` in `lib/storage/requestsStore.ts` does ListObjectsV2 with prefix `requests/`, MaxKeys limit, then GetObject for **each** key. No pagination token exposed to API; sort by LastModified desc, slice. **Bottleneck:** O(n) S3 GETs and list size; 50 (list) / 200 (metrics) / 1000 (insights) objects per call. Growth in request count increases latency and cost.

**Sync load:** Each detail view polls sync at 3–60s (or 0 when terminal). N open details ⇒ N sync requests per interval; each sync does many GitHub GETs and one S3 updateRequest. Caching reduces GitHub calls but sync endpoint still hot per user.

**GitHub API dependency:** All PR/run state comes from GitHub. Rate limits (5000/hr for authenticated) and 429 handling (wait + retry) affect throughput. No queue for dispatch; synchronous POST to workflow_dispatch.

**Memory caches:** rateAware cache (500 entries); create idempotency Map; insights 60s payload cache; drift-eligible rate limit Map. All per-process; not shared across instances.

**Polling fanout:** List page: one GET /api/requests every 30s per client. Detail: one GET sync per tab at adaptive interval. Logs SWR on detail also polls. Many users/tabs ⇒ many list + sync calls.

**Locking under scale:** Lock is per-request in document; no distributed lock. Multiple instances can read same request; updateRequest is optimistic (version check). Lock reduces concurrent mutations per request but only on routes that use it (apply, plan, update, destroy).

---

## 12️⃣ Operational Model

**Failure handling:** API routes return 4xx/5xx JSON; errors logged (e.g. logError, console.error in sync). Lifecycle log write failures are warned and do not fail the request. GitHub rate limit (429) returned to client with message to retry; sync catches and returns 429.

**Recovery:** No automated retry of failed workflow runs in app; user can re-trigger. Optimistic lock conflict throws; client can retry. Lock TTL 2 min so stuck locks expire.

**Deploy safety:** No schema version or migration in request JSON; additive fields. Deploy is standard Next.js; no DB migrations. Build uses placeholders for env when not in Vercel/ECS so build succeeds; runtime requires real env.

**State correctness:** Status is derived; sync re-hydrates from GitHub and overwrites status. If S3 and GitHub diverge, sync brings them in line. Apply-run head-SHA check prevents attaching wrong run. No formal reconciliation job.

**Operator visibility:** Console logs (JSON); correlationId/route in logs. Insights endpoint for status counts and rates. No built-in alerting or on-call integration.

---

## 13️⃣ Code Quality & Structure

**Separation of concerns:** Clear split: routes (HTTP), storage (S3), lifecycle (derive + status-config), GitHub (client, auth, rateAware), auth (session, roles, admin). Some routes are long (e.g. requests/route.ts POST, update/route.ts) with inline validation and HCL rendering.

**Module boundaries:** Libs are feature-oriented (requests, github, auth, observability, storage). Config (env, infra-repos, module-registry, workflows, polling) is centralized. No circular dependency issues evident from imports.

**Duplication:** Normalize/validate logic (e.g. coerceByType, buildFieldMap, validatePolicy) duplicated between requests/route.ts and requests/[requestId]/apply/route.ts and update/route.ts. HCL rendering and block upsert repeated.

**Dead code risk:** Some legacy fields (e.g. activePrNumber, previousPrs) and dual PR shapes (pr vs pullRequest) kept for compatibility; no cleanup pass documented.

**Type safety:** Request shape is typed locally (StoredRequest, RequestLike, etc.); no single shared request schema. `any` used in places (e.g. stream body, S3 list contents). Idempotency/lock types are explicit.

**Readability:** Naming is consistent (deriveLifecycleStatus, updateRequest, requireSession). Comments in rateAware and lock explain behavior. Long files (sync, update, requests POST) require scrolling but flow is traceable.

---

## 14️⃣ Known Risks / Technical Debt

| Risk | Severity | Grounding |
|------|----------|-----------|
| List scale: O(n) S3 GETs and no pagination | High | `listRequests(limit)` in requestsStore.ts; list then fetch each key; list route uses 50. |
| Create idempotency in-memory only | High | `createStore` Map in idempotency.ts; lost on restart; not shared across instances. |
| Approve and merge lack request lock | Medium | ACTION_CONSISTENCY_AUDIT.md and code: no acquireLock in approve/merge routes; idempotency only. |
| Public /api/health | Low | No session; only liveness; information disclosure minimal. |
| Debug env in dev | Low | debug/env returns config (no secrets in returned object in code); 404 in prod. |
| Duplicate validation/HCL logic across routes | Medium | apply, update, requests POST share patterns; maintenance and drift risk. |
| No global API rate limiting | Medium | Only drift-eligible has per-IP limit; authenticated abuse possible. |
| Schema evolution without version field | Medium | Additive fields only; no migration or version in document. |
| Lock TTL fixed; no heartbeat | Low | 2 min TTL; long-running apply could outlive lock. |

---

## 15️⃣ Platform Maturity Assessment

| Category | Score (1–10) | Justification |
|----------|--------------|---------------|
| **Architecture** | 7 | Clear control plane and lifecycle model; single app and S3/GitHub; no queue or worker separation; boundaries documented. |
| **Reliability** | 6 | Idempotency and locking on critical mutations (except approve/merge); optimistic locking; GitHub retry/cache; create idempotency and locking coverage gaps. |
| **Safety** | 7 | Prod allowlists; role checks; apply-run SHA validation; webhook secret; no lock on approve/merge. |
| **Observability** | 5 | Structured logs and correlation; lifecycle events to S3; insights from capped list; no tracing, no alerting, no dashboard service. |
| **Scalability** | 4 | List is O(n) S3; no pagination; sync per tab; caches per-process; GitHub rate limit as ceiling. |
| **Security** | 6 | Session and role-based auth; admin gating; webhook secret; public health; debug route in dev. |
| **Developer experience** | 7 | Docs (SYSTEM_OVERVIEW, POLLING, etc.); consistent patterns; env-based config; some duplication. |
| **Operational readiness** | 5 | Health endpoint; no runbooks or automated recovery; operator visibility via logs and insights only. |

---

## 16️⃣ Competitor Positioning Context

**Terraform Cloud:** TfPilot does not run Terraform or manage state; it delegates to GitHub Actions. Comparable: request/workflow abstraction, policy (naming, region), cost estimation hook. Not comparable: remote state, sentinel, private registry, VCS-agnostic runs.

**env0:** Both use VCS (GitHub) and workflows for plan/apply. TfPilot is single-tenant/internal; env0 is SaaS with environments and policies. TfPilot has bounded block editing and marker-based blocks; env0 has full repo/dir scope. Comparable: PR-based flow, approval, drift (concept). Not comparable: multi-tenant, pricing, native RBAC.

**Atlantis:** Atlantis runs Terraform in-app (or in runner); TfPilot does not. Both: PR-centric, plan/apply from comments or UI, lock. TfPilot: UI-driven actions and sync from GitHub; Atlantis: comment-driven. Comparable: plan output in PR, apply gating. Not comparable: where Terraform runs, project structure.

**Backstage plugins:** TfPilot is a standalone app, not a Backstage plugin. Comparable: catalog-like module registry, self-service request flow. Not comparable: plugin model, software catalog, Backstage RBAC.

**Internal control planes:** Similar to in-house platforms that orchestrate infra via Git + CI: request → PR → workflow → status. TfPilot’s differentiators: single derived lifecycle, rate-aware GitHub layer, S3-only persistence, marker-based file edits, optional AI-assisted config collection.

---

*End of report. No changes or refactors proposed; assessment only.*
