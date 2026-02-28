# Status workflow spike — list vs detail discrepancy and stuck “applying”

**Purpose:** Investigation only (no code changes). Bug report: 3 requests deployed in sequence; 1 reached “deployed”, 1 cancelled; the other two show **“Pull request merged”** in the requests table but **“Deploying…” (applying)** on the request detail page.

**Findings (two bug classes, both fixed):**  
**Convergence bug:** `status: "unknown"` (or missing) on an apply/destroy attempt blocked sync from reconciling because reconciliation was gated on “active” status (queued/in_progress only). **Freshness bug:** List vs detail showed different statuses because the list cache was not revalidated when a request changed (e.g. after apply dispatch or webhook). **Fixes:** (1) **needsReconcile invariant** — sync reconciles when `runId` is present and `conclusion` is missing, regardless of `attempt.status`. (2) **Global SSE revalidator** — a single subscriber in the root layout mutates both the request-detail key and the list key on every “request” event; list mutate is debounced to avoid over-fetch on bursts.

---

## 1. Status derivation (single source of truth)

Status is **never stored**. It is always computed by `deriveLifecycleStatus(request)` in **lib/requests/deriveLifecycleStatus.ts**. The function reads only:

- `request.pr` or `request.github.pr` (merged, open, headSha)
- `request.mergedSha`
- `request.approval`
- **Current attempts only** for plan, apply, destroy via `getCurrentAttemptStrict(request.runs, kind)`

**Priority order (exact from code):**

```ts
// 1. Destroy lifecycle
if (currentDestroy?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"
if (currentDestroy?.conclusion === "success") return "destroyed"
if (currentDestroy?.runId != null && currentDestroy?.conclusion == null && !stale) return "destroying"
if (stale) return "failed"

// 2–3. Apply / plan failed
if (currentApply?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"
if (currentPlan?.conclusion && FAILED_CONCLUSIONS.includes(...)) return "failed"

// 4. Apply in-flight (runId present and no conclusion)
if (currentApply?.runId != null && currentApply?.conclusion == null) return "applying"

// 5. Apply success
if (currentApply?.conclusion === "success") return "applied"

// 6. PR merged
if (pr?.merged) return "merged"
if (request.mergedSha) return "merged"

// 7–9. Approval, plan_ready, planning, request_created
```

Destroy in-flight mirrors apply: if the current destroy attempt has **runId present and no conclusion** (any non-terminal status), the result is **"destroying"** unless the attempt is **stale** (dispatched more than `DESTROY_STALE_MINUTES` ago), in which case we derive **"failed"**. So "Destroying…" shows consistently in list and detail even when GitHub run status is temporarily "unknown".

Apply: if the current apply attempt has **runId present and no conclusion** (queued, in_progress, unknown, or any non-terminal status), the result is **"applying"** before we ever look at `pr.merged`. This ensures "Deploying…" shows consistently in list and detail even when GitHub run status is temporarily "unknown". If there is no apply attempt or it has a conclusion, we fall through to **"merged"** when `pr.merged` or `mergedSha` is set.

**Relevant snippet (deriveLifecycleStatus.ts):**

```ts
const currentApply = getCurrentAttemptStrict(runs, "apply")
// ...
// Apply in-flight: runId present and no conclusion yet (covers queued, in_progress, unknown, etc.)
if (currentApply?.runId != null && (currentApply?.conclusion == null || currentApply?.conclusion === undefined)) {
  return "applying"
}
if (currentApply?.conclusion === "success") {
  return "applied"
}
// ...
if (pr?.merged) return "merged"
```

---

## 2. Where status is used

| Consumer | Data source | When status is computed |
|----------|-------------|--------------------------|
| **List (GET /api/requests)** | `listRequests()` from S3; each item gets `status: deriveLifecycleStatus(req)` | Server-side on each list fetch |
| **List (UI)** | Uses `row.status` from the list API response; `StatusIndicator` shows `getStatusLabel(normalizeRequestStatus(row.status))` | Client uses server-provided status |
| **Detail (GET /api/requests/:id)** | `getRequest(id)` from S3; no status in response (detail page derives from request) | Client: `deriveLifecycleStatus(request)` |
| **Detail (sync response)** | Sync returns patched request; response includes `status: deriveLifecycleStatus(request)` | Server after sync |
| **Sync (tfpilot-only)** | When `doGitHub` is false, returns `request` with `status: deriveLifecycleStatus(request)` | Server |

So **list and detail both derive from the same logical shape** (request with `runs`, `pr`, `mergedSha`, etc.). The only way they can show different statuses is if they are seeing **different request payloads** (e.g. list from an earlier fetch, detail from a later one or from sync).

---

## 3. List vs detail data flow

- **List:** SWR fetches `GET /api/requests` once, then revalidates (and on `mutateList()`). The response is an array of full request objects with `status` set by the server via `deriveLifecycleStatus(req)`. The table shows that status (via `StatusIndicator` + `getStatusLabel`). So the label **“Pull request merged”** is `getStatusLabel("merged")` (see **lib/status/status-config.ts**: `merged: { label: "Pull request merged" }`).
- **Detail:** Fetches `GET /api/requests/:id` (single request from S3). No status in response; the page computes `requestStatus = deriveLifecycleStatus(request)`. If the user triggers sync, the sync response includes a patched request and a derived status; the client can replace the in-memory request with that.

**“Deploying…”** derives from: current apply attempt has **runId and no conclusion** (status-agnostic; covers queued, in_progress, unknown). List and detail use the same `deriveLifecycleStatus`, so any list vs detail difference was a **snapshot/freshness** issue (list had an older request payload), not a derivation inconsistency. With the global SSE revalidator, both caches revalidate on request events so list and detail stay in sync.

---

## 4. Apply dispatch and when runId/attempt are persisted

Apply is triggered via **POST /api/github/apply** (**app/api/github/apply/route.ts**). Flow:

1. Dispatch workflow (workflow_dispatch).
2. Resolve runId by polling **resolveApplyRunId** (list workflow runs by branch, filter by `created_at >= dispatchTime - tolerance`, exclude runs already in run index for another request). Up to 12 attempts with backoff.
3. **Only if** `runIdApply != null` and `urlApply != null`:
   - Write run index.
   - Call `persistDispatchAttempt(current, "apply", { runId, url, actor })` and `updateRequest(request.id, ...)` so that `runs.apply` gets a new attempt with `runId` and `status: "queued"`.

**Critical snippet (apply/route.ts):**

```ts
const runsPatch =
  runId != null && runUrl != null
    ? persistDispatchAttempt(current as Record<string, unknown>, "apply", {
        runId,
        url: runUrl,
        actor: session.login,
      })
    : {}
return {
  ...current,
  ...runsPatch,
  updatedAt: (runsPatch as { updatedAt?: string })?.updatedAt ?? nowIso,
}
```

So if **resolveApplyRunId** never returns a run (e.g. GitHub API delay, wrong branch, or runs list not yet containing the new run), **no apply attempt is persisted**. The request in S3 still has `runs.apply.currentAttempt === 0` (or no apply attempt). So `deriveLifecycleStatus` keeps returning **"merged"** even though the user clicked Deploy and the workflow may have been dispatched.

**Potential issue 1:** If run resolution fails after dispatch, the UI has no apply attempt; status stays “merged” and the user has no indication that apply was dispatched but not tracked.

---

## 5. Sync and when the apply run is updated

Sync (**GET /api/requests/:id/sync**) runs GitHub calls when:

- `repair=1` or `hydrate=1`, or
- `needsRepair(request)`, or
- **Any current attempt (plan/apply/destroy) needs reconciliation** (`hasActiveAttemptNeedingFetch` uses `needsReconcile(attempt)`).

**Reconciliation rule:** Sync fetches the run and patches the attempt when **needsReconcile(attempt)** — i.e. `runId` is present and `conclusion` is missing — for plan, apply, and destroy. This is status-agnostic (queued, in_progress, unknown all reconcile). A **noop cooldown** applies when a reconcile fetch returns a non-terminal payload and produces no persisted patch (60s in-memory backoff per attempt) to avoid hammering the API.

**Destroy symmetry:** Destroy in-flight is derived the same way (runId + no conclusion, with stale guard). The same reconciliation invariant applies: plan, apply, and destroy are all reconciled when `needsReconcile(attempt)` is true.

---

## 6. needsRepair and “apply” facts

**lib/requests/syncPolicy.ts** defines `needsRepair(request)`. It does **not** explicitly say “apply attempt has no runId → repair”. It does:

- If we have PR or mergedSha, we require “run facts” for plan, apply, destroy via `hasPlanRun`, `hasApplyRun`, `hasDestroyRun`.
- `hasApplyRun(request)` is `true` when the current apply attempt has `runId`, or `status`, or `conclusion`.

So if there is **no** apply attempt (`currentAttempt === 0`), `hasApplyRun` is false. Then `needsRepair` can be true and sync will do GitHub calls — but the sync logic that **fetches** the apply run only runs when **needsReconcile(applyAttempt)** (runId present and conclusion missing). Repair does not “discover” an apply runId for an attempt that was never created. So the only way to get from “merged” to “applying” or “applied” is to have an apply attempt with runId (and then sync or webhook to patch conclusion).

---

## 7. Summary of potential causes for the reported bug

**Observed:** Table shows “Pull request merged” for two requests; detail shows “Deploying…” (applying).

**Possible causes:**

1. **List cache staleness**  
   List was fetched **before** apply was dispatched (or before the apply attempt was persisted). So the list still has the request with no apply attempt → “merged”. Detail was opened later and got a fresh request (or from sync) with the apply attempt → “applying”. So list and detail are showing different versions of the same request.

2. **Apply runId resolution failed**  
   User clicked Deploy; workflow was dispatched but `resolveApplyRunId` never found the run (e.g. GitHub delay, branch mismatch, or run index filtering). Then no apply attempt was persisted; status remains “merged” everywhere. If in some cases an attempt is persisted without runId (e.g. different code path or legacy), sync would never update it and we could still see “applying” on detail if the UI ever showed an attempt (current code path does not persist attempt without runId).

3. **Apply attempt persisted with runId but sync never updated it**  
   Apply was dispatched and runId was resolved; attempt was saved with `status: "queued"`. So status becomes “applying”. If the **list** was never refetched after that (e.g. no `mutateList()`, or visible sync didn’t include that id or didn’t run), the list could still show the old “merged” snapshot. Detail, when opened, fetches the single request and sees the apply attempt → “applying”. Webhook or sync could later set `conclusion: "success"` and move to “applied”, but if webhook was lost and sync didn’t run (or failed), we stay “applying”.

4. **Concurrency / race**  
   Three deploys in a row (same or different requests) could cause: lock contention, one apply succeeding and updating the request, others failing or timing out before persistence. So one request reaches “applied”, another might be “cancelled” (e.g. user or workflow), and two might be left with an apply attempt in progress or with no attempt persisted, leading to list vs detail and/or stuck “applying”.

5. **Display bug (unlikely)**  
   List and detail use the same derivation and same status labels; the only difference is which request payload they use. So a pure “display bug” (e.g. wrong label for “applying”) would not explain “merged” in one place and “applying” in the other — that’s a data/timing issue.

---

## 8. Relevant code locations (quick reference)

| Area | File | Notes |
|------|------|--------|
| Derivation | `lib/requests/deriveLifecycleStatus.ts` | Full priority order; uses `getCurrentAttemptStrict(runs, "plan"|"apply"|"destroy")` |
| Current attempt | `lib/requests/runsModel.ts` | `getCurrentAttemptStrict`, `persistDispatchAttempt`, `patchAttemptByRunId`; only current attempt used for status |
| List API | `app/api/requests/route.ts` (GET) | `requests = raw.map(req => ({ ...req, status: deriveLifecycleStatus(req) }))` |
| List UI | `app/requests/page.tsx` | `status: deriveLifecycleStatus(r)` when mapping; table uses `normalizeRequestStatus(item.status)` + `StatusIndicator` |
| Detail UI | `app/requests/[requestId]/page.tsx` | `requestStatus = deriveLifecycleStatus(request)` |
| Status labels | `lib/status/status-config.ts` | `merged: { label: "Pull request merged" }`, `applying: { label: "Deploying…" }` |
| Apply dispatch | `app/api/github/apply/route.ts` | Persists apply attempt **only** when `runId != null && runUrl != null` |
| Apply runId | `lib/requests/resolveApplyRunId.ts` | Lists workflow runs by branch; filters by `created_at >= dispatchTime - tolerance`; excludes runs already in run index |
| Sync | `app/api/requests/[requestId]/sync/route.ts` | Fetches apply run when `needsReconcile(applyAttempt)` (runId present and conclusion missing); then `patchAttemptByRunId` and `updateRequest`. Fix: no longer gates on `isAttemptActive`, so stuck "unknown" attempts are reconciled. |
| Repair | `lib/requests/syncPolicy.ts` | `needsRepair`; `hasApplyRun` uses current attempt’s runId/status/conclusion |

---

## 9. Freshness contract (list + detail revalidation)

To fix list-vs-detail staleness (list showing “Pull request merged” while detail shows “Deploying…”):

- **Single source of invalidation:** A single subscriber in the app root (`RequestStreamRevalidator` in `lib/sse/RequestStreamRevalidator.tsx`) listens to SSE “request” events. On each event it calls `mutate(req:${requestId})` and `mutate("/api/requests")`, so both the request-detail cache and the list cache revalidate. It is mounted in the root layout only, so it is stable across route transitions and does not remount on navigation—ensuring exactly one subscriber and no duplicate logs per SSE event. Per-request mutate is immediate; list mutate is debounced (see below).
- **List page:** Uses SWR key `/api/requests` and displays the list API response; when the root revalidator mutates `/api/requests` (after a 300ms debounce to coalesce bursty events), the list refetches. When navigating back from detail → list, the list is already stale-marked so it refetches on mount.
- **Detail page:** Uses `useRequest(requestId)` with key `req:${id}`; when the revalidator mutates that key, the detail refetches. Status is derived from the same request facts on both list (server) and detail (client from sync response).

**Debug:** Set `NEXT_PUBLIC_DEBUG_SSE=1` to log `event=sse.request_updated` per event. Navigate between routes and trigger SSE events; you should see one log per SSE event (no duplicates). If you see duplicate logs for the same event, the component may be remounting (e.g. moved to a nested layout).

---

## 10. Recommendations (for future work, not implemented in this spike)

- **List revalidation:** Implemented via `RequestStreamRevalidator`: every SSE “request updated” event mutates `req:${requestId}` immediately and `/api/requests` after a 300ms debounce (avoids over-fetch on bursts), so list and detail stay in sync. List still calls `mutateList()` after visible-row sync batches.
- **Apply without runId:** Consider persisting an apply attempt even when runId resolution fails (e.g. `status: "queued"`, no runId), so status moves to “applying” and sync can later try to “discover” runId (e.g. by branch + time) similar to plan, and then patch the attempt.
- **Sync when apply has no runId:** If current apply attempt exists but has no runId, consider a “discover runId” path in sync (list workflow runs by branch/ref, match by time and requestId) and then patch runId and fetch run status.
- **Observability:** Log when apply dispatch succeeds but runId resolution fails (already partially present); and when sync skips apply fetch because runId is null.

**Fix applied (sync convergence):** `needsReconcile(attempt)` in `lib/requests/runsModel.ts` — eligible when `runId != null && conclusion == null`. Sync uses this for **apply**, **destroy**, and **plan** instead of `isAttemptActive` only, so attempts stuck with `status: "unknown"` and no conclusion are fetched and patched. Regression test: `npx tsx scripts/validate-sync-reconcile.ts`.

**Noop cooldown:** Cooldown is set only when the reconcile fetch produces no patch **and** the GitHub run payload is non-terminal (missing/undefined status or conclusion, or status !== "completed"). If the payload is terminal (status === "completed" and conclusion present), we do not set cooldown. In-memory map keyed by requestId:kind:runId, 60s skip. Logged as `event=sync.reconcile_skipped_cooldown` when skipped; `event=sync.reconcile_cooldown_set` with reason "noop + nonterminal payload" when cooldown is set (DEBUG_WEBHOOKS=1).

**Derivation (Deploying… / Destroying…):** `deriveLifecycleStatus` treats apply as in-flight when the current apply attempt has **runId present and no conclusion** (regardless of `attempt.status`). Destroy mirrors this: **runId present and no conclusion** ⇒ "destroying", with a **stale guard** (past `DESTROY_STALE_MINUTES` ⇒ "failed"). So list and detail both show "Deploying…" or "Destroying…" consistently until the run completes or fails. Regression test: `npm run validate:derive-status` or `npx tsx scripts/validate-derive-status.ts`.

---

## 11. Remaining considerations

- **Apply dispatch without resolved runId:** If `resolveApplyRunId` fails after workflow dispatch, no apply attempt is persisted (current apply route only persists when `runId != null && runUrl != null`). The request has no in-flight apply visibility; status remains “merged” until a later code path or manual repair creates an attempt with runId. **Future improvement:** RunId discovery during sync (e.g. list workflow runs by branch/ref, match by time and requestId) for attempts that exist but lack runId — not implemented today.
