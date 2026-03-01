# Forensic Report: Storage Model & Tier A Invariants (Read-Only)

Strict read-only mapping of current implementation for S3 → Postgres migration. Bullet points only; no code changes.

---

## SECTION 1 — STORAGE MODEL

### 1. S3 prefixes used (requests bucket: `TFPILOT_REQUESTS_BUCKET`)

- **requests/**
  - Read: `lib/storage/requestsStore.ts` — `getRequest` (GetObject), `listRequests` (ListObjectsV2 + GetObject per key), `fetchCurrentVersion` (via getRequest)
  - Write: `lib/storage/requestsStore.ts` — `putRequest` (called by `saveRequest`), `updateRequest` (via saveRequest)
  - Function names: `getRequest`, `putRequest`, `saveRequest`, `updateRequest`, `listRequests`

- **history/**
  - Read: NOT FOUND (no read of history prefix in codebase)
  - Write: `lib/storage/requestsStore.ts` — `putHistory` (called by `archiveRequest`)
  - Function names: `putHistory`, `archiveRequest`

- **logs/** (lifecycle events per request)
  - Read: `lib/logs/lifecycle.ts` — `fetchLifecycleEvents` (ListObjectsV2 under `logs/${requestId}/`, then GetObject per key)
  - Write: `lib/logs/lifecycle.ts` — `logLifecycleEvent` (PutObject via `toKey(requestId, ts)` → `logs/${requestId}/${ts}.json`)
  - Function names: `fetchLifecycleEvents`, `logLifecycleEvent`, `toKey`

- **webhooks/github/run-index/** (key pattern: `<INDEX_PREFIX><kind>/run-<runId>.json`, `INDEX_PREFIX = "webhooks/github/run-index/"`)
  - Read: `lib/requests/runIndex.ts` — `getRequestIdByRunId` (GetObject with `indexKey(kind, runId)`)
  - Write: `lib/requests/runIndex.ts` — `putRunIndex` (PutObject with `indexKey(kind, runId)`)
  - Function names: `getRequestIdByRunId`, `putRunIndex`, `indexKey`

- **webhooks/github/deliveries/**
  - Read: `lib/github/webhook/idempotency.ts` — `hasDelivery` (HeadObject via `deliveryKey(deliveryId)`)
  - Write: `lib/github/webhook/idempotency.ts` — `recordDelivery` (PutObject via `deliveryKey(deliveryId)`)
  - Function names: `hasDelivery`, `recordDelivery`, `deliveryKey`

- **cost/** (cost/<requestId>/infracost-cost.json, cost/<requestId>/infracost-diff.json)
  - Read: `lib/services/cost-service.ts` — `getRequestCost` (GetObject for costKey, diffKey)
  - Write: NOT FOUND in app code (workflows/Infracost upload to S3; app does not write cost/)
  - Function names: `getRequestCost`

- **webhooks/github/stream.json** (single object, not a prefix)
  - Read: `lib/github/streamState.ts` — `getStreamState` (GetObject)
  - Write: `lib/github/streamState.ts` — `appendStreamEvent` (PutObject)
  - Function names: `getStreamState`, `appendStreamEvent`

- **webhooks/github/pr-index/** (key: `webhooks/github/pr-index/{owner}_{repo}/pr-{prNumber}.json`)
  - Read: `lib/requests/prIndex.ts` — `getRequestIdByPr` (GetObject)
  - Write: `lib/requests/prIndex.ts` — `putPrIndex` (PutObject)
  - Function names: `getRequestIdByPr`, `putPrIndex`, `prIndexKey`

- **webhooks/github/ratelimit/** (key: `webhooks/github/ratelimit/{owner}_{repo}.json` or `webhooks/github/ratelimit/global.json`)
  - Read: `lib/github/rateLimitState.ts` — `getRateLimitBackoff` (GetObject)
  - Write: `lib/github/rateLimitState.ts` — `setRateLimitBackoff` (PutObject)
  - Function names: `getRateLimitBackoff`, `setRateLimitBackoff`, `rateLimitKey`

Other buckets:
- **Templates:** `lib/templates-store.ts` uses `TFPILOT_TEMPLATES_BUCKET`, prefix `templates/` (not requests bucket).
- **Chat logs:** `app/api/chat-logs/route.ts` uses `TFPILOT_CHAT_LOGS_BUCKET`, prefix `logs/` (separate bucket).

### 2. Other persistence

- No Redis in codebase (only comment in `app/api/requests/drift-eligible/route.ts` suggesting Redis for production).
- No Postgres/DB client in codebase (docs say "no DB").
- Filesystem: `app/api/modules/catalog/route.ts` uses `stat(dir)` and `readdir(dir)` for module catalog (filesystem dir), not request/lifecycle state.

### 3. In-memory maps (reconcile / discovery cooldown)

- **reconcileNoopAt** — `app/api/requests/[requestId]/sync/route.ts` — variable: `reconcileNoopAt` (Map<string, number>). Set: `setReconcileCooldown`. Checked: `isInReconcileCooldown`.
- **discoveryNoopAt** — `app/api/requests/[requestId]/sync/route.ts` — variable: `discoveryNoopAt` (Map<string, number>). Set: `setDiscoveryCooldown`. Checked: `isInDiscoveryCooldown`.

---

## SECTION 2 — RUN EXECUTION MODEL (Invariant Cross-Check)

### INV-CORE-1: Run state only under request.runs.plan/apply/destroy

- No top-level run state: Run execution state is only in `request.runs.plan`, `request.runs.apply`, `request.runs.destroy` (each with `currentAttempt` and `attempts`). No `request.planRunId` / `request.applyRunId` etc. used as authoritative run state. Single reference to `request.plan` in sync route is for plan diff/timeline (line 1079), not run execution.
- No legacy run fields used as source of truth: Derivation uses `request.runs` and `getCurrentAttemptStrict` only (`lib/requests/deriveLifecycleStatus.ts`).
- **AttemptRecord definition:** `lib/requests/runsModel.ts` — type `AttemptRecord` (lines 6–18). `RunOpState`, `RunsState`, `EMPTY_RUNS`, `ensureRuns` in same file.

### INV-CORE-3: Only dispatch path creates attempts

- **persistDispatchAttempt:** `lib/requests/runsModel.ts` — function `persistDispatchAttempt` (lines 75–100).
- **Call sites:**
  - `app/api/requests/route.ts` — line 733 (plan, create flow)
  - `app/api/github/plan/route.ts` — line 151 (plan dispatch)
  - `app/api/github/apply/route.ts` — line 189 (apply dispatch)
  - `app/api/requests/[requestId]/apply/route.ts` — line 402 (apply dispatch)
  - `app/api/requests/[requestId]/destroy/route.ts` — line 258 (destroy dispatch)
  - `app/api/requests/update/route.ts` — line 649 (plan re-dispatch)
- Webhook does not append attempts: `app/api/github/webhook/route.ts` uses `patchRunsAttemptByRunId` (patch by runId only). No `persistDispatchAttempt`, no `currentAttempt` change, no push to `attempts[]`.
- Sync does not append attempts: `app/api/requests/[requestId]/sync/route.ts` uses `patchAttemptByRunId`, `patchAttemptRunId` only (patch/attach runId). No `persistDispatchAttempt`, no increment of `currentAttempt`, no append to `attempts[]`.

### INV-CORE-4: Current attempt = attempt === currentAttempt

- Enforcing helper: `lib/requests/runsModel.ts` — `getCurrentAttemptStrict(runs, kind)` (lines 262–268). Returns the attempt where `a.attempt === runs[kind].currentAttempt`; no fallback to "last" or "latest by time".
- Used for derivation and gates: `deriveLifecycleStatus` and sync both use `getCurrentAttemptStrict` for plan/apply/destroy.

---

## SECTION 3 — LIFECYCLE STATUS SAFETY AUDIT

### 1. Writes to request.status / request["status"] / spreads including status from storage

- **Single response-time assignment (not persisted):** `app/api/requests/[requestId]/route.ts` line 36 — `(request as { status?: string }).status = deriveLifecycleStatus(request)`. Comment on line 34: "Derive status for response only (do not persist)". Request is not saved after this; response is JSON with derived status.
- **Sync response:** `app/api/requests/[requestId]/sync/route.ts` — `tfpilotOnlyResponse` and final JSON set `status: deriveLifecycleStatus(request)` (or `derivedStatus`) in the response object only. Line 965: "Status is derived in response only; do not persist request.status". No `saveRequest`/`updateRequest` with a `status` field.
- **List API:** `app/api/requests/route.ts` line 826 — `status: deriveLifecycleStatus(req)` in mapped response only; not written to storage.
- No other assignments to `request.status` or `request["status"]` that are then persisted. No object spread that pulls `status` from storage and uses it as source of truth.

### 2. Comparisons against lifecycle strings outside deriveLifecycleStatus

- All comparisons to lifecycle strings ("applied", "planning", "merged", "failed", etc.) that affect business logic use a **derived** status (output of `deriveLifecycleStatus`) or attempt/run facts, not a stored `request.status`:
  - `app/api/requests/[requestId]/apply/route.ts` — `deriveLifecycleStatus(request)` then `status === "merged"`, `status === "failed"`, etc.
  - `app/api/requests/drift-eligible/route.ts` — `deriveLifecycleStatus(request)` then `status === "applied"`, `status === "planning"`, etc.
  - `app/api/requests/update/route.ts` — `deriveLifecycleStatus(request)` then `status === "applying"`, etc.
  - `app/api/requests/[requestId]/clarifications/respond/route.ts` — same pattern.
  - `app/api/metrics/route.ts` — `deriveLifecycleStatus(req)` then `status === "applied"`, `status === "failed"`.
  - `lib/observability/ops-metrics.ts` — `deriveLifecycleStatus(row)` then `status === "failed"`.
  - `lib/config/polling.ts` — `deriveLifecycleStatus(request)` then `isTerminalStatus(status)`, `isActiveStatus(status)`.
- Comparisons to `attempt.status` or `runJson.status` (e.g. "completed", "queued", "in_progress") are against **attempt/run payload** fields, not stored request lifecycle status; they are in runsModel, sync, webhook, and deriveLifecycleStatus (which reads attempt state).

### 3. deriveLifecycleStatus as single lifecycle source

- **Definition:** `lib/requests/deriveLifecycleStatus.ts` — function `deriveLifecycleStatus` (line 49).
- **Call sites:** `app/api/requests/[requestId]/sync/route.ts` (lines 104, 962, 1089), `app/api/requests/[requestId]/route.ts` (line 36), `app/api/requests/route.ts` (line 826), `app/api/requests/update/route.ts` (line 453), `app/api/requests/[requestId]/apply/route.ts` (lines 194, 317), `app/api/requests/[requestId]/clarifications/respond/route.ts` (line 184), `app/api/requests/drift-eligible/route.ts` (line 90), `app/api/github/apply/route.ts` (line 97), `app/api/metrics/route.ts` (line 37), `lib/observability/ops-metrics.ts` (line 76), `lib/config/polling.ts` (line 62), plus scripts/validate-derive-status.ts.

### 4. No business logic gates on stored request.status

- All action enablement (e.g. Apply button, drift-eligible, repair) uses `deriveLifecycleStatus(request)` or request facts (e.g. `getCurrentAttemptStrict`, `applyAttempt?.status`, `approval`, `request.mergedSha`). No check of a stored `request.status` for gating.

---

## SECTION 4 — RECONCILIATION CONTRACT

### INV-REC-1: needsReconcile

- **Location:** `lib/requests/runsModel.ts` — function `needsReconcile(attempt)` (lines 284–291).
- **Logic:** Returns true when `attempt.runId != null` and (`attempt.conclusion == null` or `attempt.conclusion === undefined` or `attempt.completedAt == null`). Matches: runId present AND (conclusion missing OR completedAt missing).

### INV-REC-3: Reconcile fetch bypassCache

- **Location:** `app/api/requests/[requestId]/sync/route.ts` — reconcile run fetch (GET single run by runId) passes `bypassCache: true` to `githubRequest` at lines 541 (apply), 667 (plan), 880 (destroy).
- **Option definition:** `lib/github/rateAware.ts` — `bypassCache?: boolean` (line 81), default false; when true cache is skipped (lines 110–111).

### INV-REC-4: Noop cooldown

- **Variable:** `app/api/requests/[requestId]/sync/route.ts` — `reconcileNoopAt` (Map<string, number>), line 32.
- **Set:** `setReconcileCooldown(requestId, kind, runId)` — line 71; called when reconcile fetch returns non-terminal payload and patch produced no change (e.g. lines 521, 572, 698, 918).
- **Checked:** `isInReconcileCooldown(requestId, kind, runId)` — line 64; used to skip reconcile when in cooldown (e.g. applyInCooldown, planInCooldown, destroyInCooldown).
- **Constant:** `RECONCILE_NOOP_COOLDOWN_MS = 60_000` (line 30).

---

## SECTION 5 — COMPLETION TIME SINGLE-SOURCE RULE

### INV-COMP-1: patchAttemptByRunId

- **Location:** `lib/requests/runsModel.ts` — function `patchAttemptByRunId` (lines 157–218).
- **completedAt only set there:** No other code path sets `completedAt` on an attempt; sync and webhook call `patchAttemptByRunId` (or `patchRunsAttemptByRunId` which calls it).
- **completedAt never cleared:** Logic keeps `existing.completedAt`; when `gh.status === "completed"` it sets `finalCompletedAt` from `nonEmpty(gh.completed_at) ?? nonEmpty(gh.updated_at)`; no branch sets completedAt to undefined.
- **Rule:** `finalCompletedAt = existing.completedAt ?? (gh.status === "completed" ? (nonEmpty(gh.completed_at) ?? nonEmpty(gh.updated_at)) : undefined)` (lines 186–190).
- **Callers pass updated_at:** Sync route passes `completed_at: runJson.completed_at`, `updated_at: runJson.updated_at` (e.g. lines 367–369, 514–518, 691–695, 913–917). `lib/requests/patchRequestFacts.ts` `patchRunsAttemptByRunId` passes `completed_at: run.completed_at`, `updated_at: run.updated_at` (lines 237–239, 265–267).

---

## SECTION 6 — LOCKING INVARIANTS

- **isLockActive:** `lib/requests/lock.ts` — function `isLockActive(lock, now)` (lines 56–61). True iff lock exists, valid `expiresAt`, and `now.getTime() < t`.
- **isLockExpired:** `lib/requests/lock.ts` — function `isLockExpired(lock, now)` (lines 47–51). True when no lock, no expiresAt, or now >= expiresAt.
- **acquireLock:** `lib/requests/lock.ts` — function `acquireLock(opts)` (lines 69–98). If no lock or `isLockExpired(existing, now)` → allow acquire; else same holder → no-op; else throw `LockConflictError`.
- **Sync expired lock clearing:** `app/api/requests/[requestId]/sync/route.ts` lines 125–138: if `lock && isLockExpired(lock, new Date())`, `updateRequest` with `lock: undefined` and persist. Expired lock treated as inactive and removed.
- Expired lock treated as inactive: `isLockActive` returns false when expiresAt is in the past; `acquireLock` treats expired as "no lock"; sync clears it. No code path disables actions based on lock without checking activity (UI should use `isLockActive(request.lock)` per INV-LOCK-2).

---

## SECTION 7 — WEBHOOK + RUN INDEX

- **Webhook entrypoint:** `app/api/github/webhook/route.ts` — POST handler; signature verification, then event branching (`pull_request`, `pull_request_review`, `workflow_run`).
- **Correlation order (workflow_run):** For `workflow_run`, kind from `classifyWorkflowRun`. Correlation: (1) if kind and wr.id present, `getRequestIdByRunId(kind, wr.id)` (index first); (2) if null and kind === "destroy", `getRequestIdByDestroyRunId(wr.id)` (destroy fallback); (3) else `correlateWorkflowRun(payload)` (fallback).
- **putRunIndex:** `lib/requests/runIndex.ts` — `putRunIndex(kind, runId, requestId)`. Called from: `app/api/github/plan/route.ts` (after dispatch when runId known), `app/api/github/apply/route.ts`, `app/api/requests/[requestId]/destroy/route.ts`, and sync route when discovery attaches runId (putRunIndex after patchAttemptRunId) — e.g. apply line 456, destroy line 794.
- **getRequestIdByRunId:** `lib/requests/runIndex.ts` — `getRequestIdByRunId(kind, runId)`. Used in webhook (index-first correlation) and in sync (discovery: check candidate run not claimed by another request).
- **Delivery idempotency:** `hasDelivery(deliveryId)` before processing; after processing `recordDelivery(deliveryId, event)`. Early return `{ duplicate: true }` if already delivered (lines 41–43).
- **Patch monotonic:** Webhook and sync only call `patchAttemptByRunId` / `patchRunsAttemptByRunId`; no regression logic (no clearing completedAt/conclusion, no overwriting completed with in_progress in patch; runsModel enforces monotonicity in `patchAttemptByRunId`).

---

## SECTION 8 — LIST VS DETAIL STATUS CONSISTENCY

- **GET /api/requests (list):** `app/api/requests/route.ts` GET — uses `listRequests()`, then maps each request with `status: deriveLifecycleStatus(req)` (line 826). List derives status server-side; no stored status returned.
- **GET /api/requests/:id (detail):** `app/api/requests/[requestId]/route.ts` GET — loads request via `getRequest(requestId)`, then `(request as { status?: string }).status = deriveLifecycleStatus(request)` (line 36). Detail derives status server-side for response only (not persisted).
- **SSE revalidator:** Client uses `useRequestStatus` (`hooks/use-request-status.ts`) which fetches `/api/requests/${requestId}/sync` (sync endpoint). Sync response includes request with `status: deriveLifecycleStatus(...)` (sync route). `subscribeToRequestEvents` (from `lib/sse/streamClient`) triggers mutate on event for that requestId, causing re-fetch of sync. So both list and detail data can be updated by SSE-driven revalidation; in both cases the response body includes a derived status (list from GET /api/requests, detail from GET /api/requests/:id and from GET /api/requests/:id/sync). Keys mutated by SSE: SWR key is sync URL; mutate is called on stream event for requestId, so the same request’s sync (and thus detail) is revalidated.

---

## SECTION 9 — POLLING CONTRACT

- **Config:** `lib/config/polling.ts` — `SYNC_INTERVAL_ACTIVE_MS` (default 10_000), `SYNC_INTERVAL_IDLE_MS` (default 30_000), `SYNC_INTERVAL_HIDDEN_MS` (default 120_000), `SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS` (default 60_000). `getSyncPollingInterval(request, tabHidden)` returns 0 when `isTerminalStatus(status)`, else tab hidden → HIDDEN_MS, else active → ACTIVE_MS, else IDLE_MS. Status from `deriveLifecycleStatus(request)`.
- **429 backoff:** `hooks/use-request-status.ts` — when `errorRef.current?.status === 429`, `refreshInterval` returns `SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS` (line 109); `onErrorRetry` for 429 uses `setTimeout(revalidate, SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS)` (lines 127–129).
- **Terminal states stop polling:** `getSyncPollingInterval` returns 0 when `isTerminalStatus(status)` (`lib/config/polling.ts` line 62). So polling interval 0 for terminal status; no further timed polling for that request.

---

## Summary (Tier A)

- **Storage:** All request/lifecycle-relevant S3 usage in requests bucket is under the prefixes and keys listed; no other persistence for this domain. In-memory cooldown maps only in sync route.
- **Run state:** Only under `request.runs.{plan,apply,destroy}`; only dispatch path creates/increments attempts; current attempt is strictly `getCurrentAttemptStrict`.
- **Status:** Lifecycle status is never stored as source of truth; it is always derived via `deriveLifecycleStatus`; no business logic gates on stored `request.status`.
- **Reconcile:** `needsReconcile` matches runId present and (conclusion or completedAt) missing; reconcile fetch uses `bypassCache: true`; noop cooldown is set/checked in sync route.
- **Completion time:** Only `patchAttemptByRunId` sets completedAt; never cleared; uses `completed_at ?? updated_at`; callers pass updated_at.
- **Locks:** Active = isLockActive; expired cleared in sync; acquire treats expired as no lock.
- **Webhook/run index:** Index used first; fallback order as above; delivery idempotency; patch is monotonic.
- **List/detail:** Both use derived status; SSE triggers revalidation for the same request’s data.
- **Polling:** Intervals and 429 backoff as above; terminal status stops polling.
