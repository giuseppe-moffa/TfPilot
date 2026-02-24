# TfPilot UI State + Lifecycle UX Audit (Detail + Table)

**Date:** 2025-02-23  
**Scope:** Request detail page, requests table, hooks, API mutation responses. Read-only; no code changes.  
**Goal:** Diagnose timeline/button lag and stickiness; propose minimal safe fix.

---

## Current architecture map

### 1. Request detail page — source of truth and render pipeline

**File:** `app/requests/[requestId]/page.tsx`

| Concern | Source of truth | Where used |
|--------|------------------|-------------|
| **Request document** | SWR cache keyed by `/api/requests/${requestId}/sync?nonce=${nonce}`. Fetcher returns `json.request ?? json`. Data comes from `useRequestStatus(requestId, initialRequest).request` (i.e. `data ?? initial ?? null`). | All derived values, timeline, buttons, badges. |
| **Derived status** | `requestStatus = request ? deriveLifecycleStatus(request) : "request_created"` — computed once per render from `request`. No stored `request.status` used for UI logic on detail. | `isPlanReady`, `isApproved`, `isMerged`, `isApplied`, `isDestroying`, `isDestroyed`, `isFailed`, `canonicalStatus`, timeline step state, `isActionDisabled`. |
| **In-flight / local UX** | Local React state: `isApproving`, `mergeStatus`, `isApplying`, `destroyInFlight`, `actionProgress` (op + state + error), modal open states, `destroyConfirmation`. | Button disabled, timeline labels (“Approving…”, “Merging…”), ActionProgressDialog. |
| **Facts used for disable/labels** | From `request`: `request?.approval?.approved`, `request?.pr?.merged`, `request?.mergedSha`, `request?.applyRun?.status`, `request?.destroyRun?.status`, `request?.planRun`, `request?.lock`. | `prMerged`, `applyRunActive`, `destroyRunActive`, `hasLock`, `isActionDisabled`, `computeStepInfo`, `getStepDisplayLabel`. |
| **Timeline step timestamps** | `logsData` from SWR key `/api/requests/${requestId}/logs` → `sortedEvents` → `eventToStep` + `formatDate` → `stepTimestamps`. | Passed to `<TimelineStep timestamp={stepTimestamps[step.key]} />`. |
| **Timeline step state and labels** | `computeStepInfo()` (current step key + subtitle), `stepState(stepKey)` (done/pending), `getStepDisplayLabel()` (label string). All use `request`, `requestStatus`, `actionProgress`, `mergeStatus`, `isApproving`, `applyRunActive`, `destroyRunActive`, etc. | Timeline steps: which step is “current”, done, or pending; label text. |
| **Status badge** | `canonicalStatus = normalizeRequestStatus(isDestroyed ? "destroyed" : isDestroying ? "destroying" : requestStatus, { isDestroyed, isDestroying })`. So badge is derived from `requestStatus` (and overrides for destroy). | `<StatusIndicator status={canonicalStatus} />`. |
| **Button disabled** | `isActionDisabled(action)` — see formulas below. | Each action button: `disabled={isActionDisabled("approve")}` etc. |

**Render pipeline (concise):**

1. `request` from `useRequestStatus` (SWR sync endpoint; key includes nonce).
2. `requestStatus = deriveLifecycleStatus(request)`.
3. Booleans from facts: `prMerged`, `applyRunActive`, `destroyRunActive`, `isPlanReady`, `isApproved`, `isMerged`, `isApplied`, `isDestroying`, `isDestroyed`, `isFailed`, `hasLock`, etc.
4. `computeStepInfo()` → `stepInfo`; `stepState(stepKey)`; `getStepDisplayLabel(step.key, state, status)`.
5. Status badge: `canonicalStatus`. Buttons: `isActionDisabled(action)`.
6. Timeline timestamps: from `logsData` (separate SWR), not from `request`.

So: **single source of truth for “what the request is”** = SWR cache for the sync URL. **Derived status** is recomputed every render from `request`. **Timeline** is hybrid: step state/labels from request + facts + local state; timestamps from logs only.

---

### 2. Requests table page

**File:** `app/requests/page.tsx`

| Concern | Implementation |
|--------|------------------|
| **Data** | `useSWR("/api/requests", fetcher, { refreshInterval: 30_000, revalidateOnFocus: true, keepPreviousData: true })`. |
| **Row state** | `data?.requests` → effect → `setRequests(rows)`. Each row: `id`, `project`, `environment`, `module`, `service`, `status`, `createdAt`, `config`, `pullRequest`, `drift`. |
| **Status on table** | `computeStatus(row)` uses **`row.status`** (stored) and `row.pullRequest?.status`, not `deriveLifecycleStatus`. So table uses **stored status**, not derived. |
| **Update path** | No direct patch from detail page. Table only updates when SWR revalidates (30s interval or focus). So after approve/merge/apply/destroy on detail, table can show stale status for up to 30s (or until user refocuses). |

---

### 3. Hooks + shared logic

**File:** `hooks/use-request-status.ts`

| Item | Behavior |
|------|----------|
| **SWR key** | `requestId ? `/api/requests/${requestId}/sync?nonce=${nonce}` : null`. Nonce change = new key = new fetch (bypasses deduping). |
| **Fetcher** | GET sync URL; returns `json.request ?? json`. |
| **refreshInterval** | `getSyncPollingInterval(latest, tabHiddenRef.current)` — uses **`request.status`** (stored) and `isActiveStatus` / `isTerminalStatus` from `lib/status/status-config`. So polling interval is driven by **stored** status, not derived. Defaults: terminal → 0; active → 3s; idle → 10s; hidden → 60s. |
| **forceSync()** | Sets `pendingForceSyncRef.current = resolve`, then `setNonce((n) => n + 1)`. Promise resolves when effect runs after fetch completes (`!isValidating`). So UI **waits for full sync request** to finish before resolving. |
| **mutate** | Exposed as `mutate` (and used as `mutateStatus` on detail). Signature: SWR’s `mutate(data?, options?)`. Used for: patch after apply/destroy (pass returned request, no revalidate); update-config calls `mutateStatus(undefined, true)` to revalidate. |

**File:** `lib/config/polling.ts`  
- `getSyncPollingInterval(request, tabHidden)` uses `request.status` (stored). So if sync hasn’t written `status` yet, interval stays IDLE (e.g. 10s).

**Derive usage in UI:**  
- Detail page: `deriveLifecycleStatus(request)` used for `requestStatus`, and in `handleApproveConfirm` / Merge “Yes” guard. No shared “canApply/canMerge” helper; logic is inline in `isActionDisabled` and handlers.

---

### 4. API mutation responses (current)

| Endpoint | Success response shape | Does UI use response request? |
|----------|------------------------|------------------------------|
| **POST /api/requests/[id]/approve** | `{ success: true, request: updated }` | **No.** Handler only checks `!r.ok` and throws; does not read body or call `mutateStatus(response.request)`. |
| **POST /api/github/merge** | `{ ok: true, mergedSha }` | **No.** No `request` in body. UI relies on forceSync. |
| **POST /api/github/apply** | `{ ok: true, request: afterApply }` | **Yes.** `handleApplyOnly` does `if (data.request) mutateStatus(data.request, false)`. |
| **POST /api/requests/[id]/destroy** | `{ ok: true, destroyRunId, destroyRunUrl, request: updated }` | **Yes.** Destroy handler does `if (data.request) mutateStatus(data.request, false)`. |
| **POST /api/requests/update** (patch/config) | (not confirmed; likely success + optional request) | **No.** `handlePatchSubmit` calls `mutateStatus(undefined, true)` (revalidate), does not patch with response body. |
| **POST /api/github/plan** | (plan dispatch; not used from detail runAction) | N/A for detail flow. |

So: **Approve** and **Merge** never patch the detail SWR cache from the mutation response; they always wait for `forceSync()`. **Apply** and **Destroy** do patch from response, then still call `forceSync()`.

---

## A) End-to-end UI flow (per action)

### Approve

1. User clicks Approve → Approve modal open → “Yes, approve” → `handleApproveConfirm()`.
2. Guard: `request?.approval?.approved` or `derived === "approved"` or `"applied"` → skip. Else `runAction("approve", fn, { closeDialog })`.
3. `runAction`: set `isApproving`, `actionProgress = { op: "approve", state: "running" }`, close dialog, then `await fn()` (POST approve), then `await forceSync()`, then success state + 1s timeout clear.
4. **UI update:** New request only after **forceSync()** completes (sync can take ~10s). Approve API returns `{ success: true, request }` but client **does not** call `mutateStatus(data.request)`. So button/timeline stay in “old” state until sync returns.
5. **Where it blocks:** Entirely on forceSync. Button stays disabled via `actionProgress.state === "running"` and `isApproving` until finally; then disabled via `requestStatus === "approved"` only after sync.

### Merge

1. User opens Merge modal → “Yes, merge” → inline `runAction("merge", fn, { closeDialog })`. fn = POST /api/github/merge.
2. Merge API returns `{ ok: true, mergedSha }` only — **no request body**.
3. **UI update:** Only after `forceSync()`. No cache patch from response.
4. **Where it blocks:** Same as approve. Timeline and Merge button stay stale until sync completes.

### Apply

1. User opens Apply modal → “Yes, apply” → `handleApplyOnly()` → `runAction("apply", fn, closeDialog)`. fn = POST /api/github/apply, then `if (data.request) mutateStatus(data.request, false)`.
2. Apply API returns `{ ok: true, request: afterApply }` with `applyRun: { status: "in_progress", ... }`.
3. **UI update:** **Immediate** from `mutateStatus(data.request, false)`. Then `forceSync()` runs; dialog closes without success state (apply/destroy skip success overlay).
4. **Where it can lag:** If for any reason the apply route didn’t return `request` or client didn’t patch, UI would still wait for forceSync. Currently implemented correctly for instant update.

### Destroy

1. User types “destroy” → “Yes, destroy” → `runAction("destroy", fn, closeDialog)`. fn = POST destroy, then `if (data.request) mutateStatus(data.request, false)`.
2. Destroy API returns `{ ok: true, request: updated }` with `destroyRun: { status: "in_progress", ... }`.
3. **UI update:** **Immediate** from mutate. Then forceSync(); dialog closes.
4. Same as apply — instant if response is used.

### Plan

- Plan is **not** triggered from the detail page via runAction. It’s dispatched from new-request or update flow (e.g. `/api/requests/update` or similar). Detail page only **displays** plan state from `request.planRun` and sync. So no “plan click → runAction” sequence on detail; plan run state updates when sync returns new `planRun`.

### Update-config (patch)

1. User submits patch in Update Configuration modal → `handlePatchSubmit()` → POST `/api/requests/update`, then `mutateStatus(undefined, true)`.
2. **UI update:** Revalidate (full refetch). No response body used to patch cache. So update depends on next sync or the revalidate triggered by `mutateStatus(undefined, true)` (same key, so refetch). Can feel slow if sync is slow.

---

## B) State ownership + race conditions

**Sources of request state on detail page:**

1. **SWR cache** for key `/api/requests/${requestId}/sync?nonce=${nonce}` — primary. `request = data ?? initial ?? null`.
2. **Initial request** — from server (e.g. RSC) passed as `initialRequest` into `useRequestStatus(requestId, initialRequest)` as fallback.
3. **Local state** — modals, in-flight flags, `actionProgress`, `destroyConfirmation`. These don’t hold the request doc; they only affect buttons and labels.
4. **Derived** — `requestStatus`, `isPlanReady`, `isMerged`, etc., recomputed each render from `request`.

**How races happen:**

- **Mutation returns success but UI not updated:** For approve/merge, the client never writes the API response into the cache. So the only way the page gets the new facts (e.g. `approval.approved`, `pr.merged` / `mergedSha`) is the next sync. Until then, `request` is the previous value, so `requestStatus` and buttons stay stale.
- **forceSync delayed:** Sync does many GitHub and storage reads and can take on the order of 10s. So after approve/merge, the promise that runAction awaits doesn’t resolve until that long request finishes. During that time the only thing keeping the button disabled is `actionProgress.state === "running"` and in-flight flags; timeline still shows old step until sync returns.
- **SWR revalidate returns old value:** Unlikely if key includes nonce (new key = new request). But if something ever reused the same key with stale data, that would show old state.
- **Logs load separately:** Timeline **timestamps** come from `/api/requests/${requestId}/logs`. If logs are slow or empty, step labels and “current” step still update from request; only timestamps stay empty or old. So logs don’t cause step state to lag; they only affect timestamp display.

---

## C) Timeline lag root causes

- **Timeline step state and labels:** Sourced from **facts + derived status + local state**: `request`, `requestStatus`, `actionProgress`, `mergeStatus`, `isApproving`, `applyRunActive`, `destroyRunActive`, etc. So timeline **does not** require logs to show the right step or label. It only needs the **request** to be updated (from sync or from mutation response patch).
- **Timeline step timestamps:** Sourced from **logs only** (`logsData` → `sortedEvents` → `eventToStep` → `stepTimestamps`). If logs haven’t loaded or don’t contain an event yet, that step’s timestamp is missing. No fallback from facts (e.g. `request.approval` or `request.updatedAt`) is used for timestamps.
- **Lag cause for steps/labels:** For **approve** and **merge**, the request isn’t updated until forceSync completes. So timeline “current” step and labels stay on the previous step until sync returns (e.g. ~10s). For apply/destroy, the patch from the response updates `request` immediately, so timeline should flip right away.
- **Memoization/stale props:** `computeStepInfo()` and `stepState` / `getStepDisplayLabel` are plain functions of current `request`, `requestStatus`, and local state. They run every render. No memoization of “derived status” that would skip recomputation; `requestStatus` is recomputed every time. So no stale-prop issue from memo.

**Summary:** Timeline step state/labels lag when the **request** in SWR is stale (approve/merge). Timeline timestamps can be missing or delayed when **logs** are slow or empty; adding a fallback from facts (e.g. use `request.updatedAt` or event time from request when logs don’t have the step) would be an enhancement.

---

## D) Button stuck / briefly enabled root causes

**Current disable formulas (from `isActionDisabled`):**

- **Global:** `hasLock` → true; `actionProgress?.state === "running"` → true; `actionProgress?.op === action` → true.
- **Approve:** `!request` \|\| `!isPlanReady` \|\| `request?.approval?.approved` \|\| `requestStatus === "approved"` \|\| `isMerged` \|\| `isApplied` \|\| `isDestroying` \|\| `isDestroyed` \|\| `isApplyingDerived` \|\| `isFailed` \|\| `isApproving`.
- **Merge:** `!request` \|\| `mergeStatus === "pending"` \|\| `requestStatus !== "approved"` \|\| `isMerged` \|\| `isDestroying` \|\| `isDestroyed` \|\| `isFailed`.
- **Apply:** `!isMerged` \|\| `isApplied` \|\| `requestStatus === "applying"` \|\| `applyRunActive` \|\| `isApplyingDerived` \|\| `isDestroying` \|\| `isDestroyed` \|\| `isFailed` \|\| `isApplying`.
- **Destroy:** `!isApplied` \|\| `!canDestroy` \|\| `isApplying` \|\| `destroyInFlight` \|\| `requestStatus === "destroying"` \|\| `requestStatus === "destroyed"` \|\| `destroyRunActive` \|\| `isDestroying` \|\| `isDestroyed`.

**Inputs already covered:** inFlight (isApproving, mergeStatus, isApplying, destroyInFlight), lock (hasLock), actionProgress running/op, derived status, facts (prMerged, applyRunActive, destroyRunActive, approval.approved), canDestroy.

**Where “stuck” or “briefly enabled” can still happen:**

- **Approve:** After success, we set `actionProgress = null` after 1s. If for some reason the sync response hadn’t updated `request` yet (e.g. sync very slow or failed silently), `request?.approval?.approved` could still be false and `requestStatus` still not "approved". Then the Approve button would become enabled again. Mitigation: approve API returns `request`; if we patched cache with it (like apply/destroy), we’d avoid that window.
- **Merge:** Same idea: if we don’t patch from merge response and sync is slow, after the 1s success overlay closes we rely on `isMerged` (from request). If request hasn’t updated, Merge could briefly look enabled again. Merge API doesn’t return request today — so we’d need backend to return it and client to patch.
- **Apply/Destroy:** Already patched from response; button stays disabled via `applyRunActive` / `destroyRunActive` once `request` has the new run. No missing inputs in the formula.

**Derived status recomputation:** `requestStatus` and all booleans are computed in the component body every render; they are not stored in refs or memoized in a way that would skip recomputation. So no “derivedStatus computed once and never recomputed” issue.

---

## E) Minimal fix plan (no code yet)

**Objective:** Instant UX for all actions: button and timeline update as soon as the mutation succeeds, without waiting for full sync.

**1) API responses must include updated request**

- **Approve:** Already returns `{ success: true, request: updated }`. No change.
- **Merge:** Today returns `{ ok: true, mergedSha }`. **Change:** Return `{ ok: true, mergedSha, request }` where `request` is the document after `updateRequest` (with `mergedSha`, `pr.merged`, etc.).
- **Apply / Destroy:** Already return `request`. No change.
- **Update (patch):** Optionally return updated request so client can patch instead of only revalidating.

**2) Update local (SWR) state immediately after mutation**

- **Approve:** In the approve fetch callback, after `res.ok`: parse JSON, and if `data.request` exists, call `mutateStatus(data.request, false)`. So we don’t wait for forceSync for the approval fact.
- **Merge:** In the merge runAction fn, after successful POST: if `data.request` exists, call `mutateStatus(data.request, false)`.
- Apply and destroy already do this.

**3) Patches for detail vs list**

- **Detail:** All mutations that return a request body should call `mutateStatus(returnedRequest, false)` so the detail page’s SWR cache (sync key) is updated. Note: the SWR key is the *sync* URL; `mutate(data, false)` updates the cache for the *current* key. So when we’re on the detail page, the current key is `/api/requests/:id/sync?nonce=N`. Passing `mutateStatus(newRequest, false)` updates that cache entry to `newRequest`, so the next render has the new request. No change to list cache from detail is strictly required for “minimal” fix; list can still refresh on its 30s or focus.
- **List (optional):** To make the table row update without waiting 30s, we could either: (a) have a global SWR cache key for “list” and mutate the matching row when we have an updated request from a mutation (complex), or (b) trigger a one-off revalidate of `/api/requests` after a successful mutation on detail (e.g. `mutateList()` from a context or callback). Minimal approach: **detail only**; table continues to update on interval/focus.

**4) Button disable rules**

- Already include inFlight, actionProgress, lock, and facts. Only remaining risk is the short window after success overlay closes for approve/merge before sync returns; fixing (1) and (2) removes that by updating `request` from the response so `request?.approval?.approved` / `isMerged` are true immediately.

**5) forceSync still useful**

- Keep calling `forceSync()` after mutations so that eventually we have a full sync (GitHub enrichment, logs, etc.). The instant update comes from the response patch; forceSync can run in the background and overwrite with the fuller document later.

**6) Polling interval**

- Today `getSyncPollingInterval` uses `request.status` (stored). For consistency with “derived only” UI, we could pass `deriveLifecycleStatus(request)` into the interval logic so active/terminal is derived. Lower priority than instant button/timeline.

---

## F) Exact file list (minimal fix)

| File | Change |
|------|--------|
| `app/api/github/merge/route.ts` | After successful merge and `updateRequest`, read the updated request (e.g. `getRequest(request.id)` or use the updated doc from a callback) and return it in the JSON: `{ ok: true, mergedSha, request }`. |
| `app/requests/[requestId]/page.tsx` | **Approve:** In the approve `runAction` fn (or in a wrapper used by handleApproveConfirm), after `res.ok`: parse JSON, and if `data.request` is present, call `mutateStatus(data.request, false)`. **Merge:** In the merge inline fn passed to runAction, after `res.ok`: parse JSON, and if `data.request` is present, call `mutateStatus(data.request, false)`. |
| (Optional) `lib/config/polling.ts` or `hooks/use-request-status.ts` | Use derived status for `getSyncPollingInterval` so polling interval is consistent with derived lifecycle (not required for “instant UX” fix). |

No new files. No websockets/SSE. No large refactors. Lifecycle remains deterministic and fact-driven; we only add “patch cache from mutation response” for approve and merge (and ensure merge returns the request).

---

## Summary table

| Action | API returns request? | UI patches from response? | UI blocks on forceSync? | Instant today? |
|--------|----------------------|---------------------------|--------------------------|----------------|
| Approve | Yes | No | Yes | No |
| Merge | No | No | Yes | No |
| Apply | Yes | Yes | Yes (but already updated) | Yes |
| Destroy | Yes | Yes | Yes (but already updated) | Yes |
| Update-config | (optional) | No (revalidate only) | Yes (revalidate) | No |
| Plan | (N/A from detail) | — | — | — |

After minimal fix: Approve and Merge would patch from response like Apply/Destroy, so all four would feel instant; update-config could be improved separately by returning and patching request if desired.
