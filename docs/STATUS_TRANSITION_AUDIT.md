# Deep Audit: UI Status Transition Behavior

**Read-only investigation.** This document describes how request status is stored, derived, updated, and rendered so that status handling can be redesigned safely without reading the code.

---

## 1. Status architecture overview

- **Stored status:** The request document in S3 has a top-level `status` field. It is written by API routes (create, plan, apply, destroy, update, approve, merge, sync, refresh). It is one of: `created`, `planning`, `plan_ready`, `pr_open`, `awaiting_approval`, `approved`, `merged`, `applying`, `complete`, `failed`, `destroying`, `destroyed`.
- **Derived status:** `lib/requests/status.ts` exports `deriveStatus(pr, planRun, applyRun, approval)`. It returns a **RequestStatus** (same set as above minus `destroying`/`destroyed`, which are stored only, never derived). Derivation does not look at stored `request.status`; it uses only PR, runs, and approval.
- **Two modes of “truth”:**
  - For **destroyed/destroying**: stored `request.status` is authoritative. These are set only by destroy and sync; `deriveStatus` never returns them.
  - For all other states: **either** stored `request.status` **or** a freshly derived status can be used. List and sync/refresh can overwrite stored status with derived; handlers (plan, apply, approve, merge, update) write explicit status values.
- **UI normalization:** Frontend and some backend (ops-metrics) map API statuses to a **canonical** set (`lib/status/status-config.ts`: `request_created`, `planning`, `plan_ready`, `approved`, `merged`, `applying`, `applied`, `destroying`, `destroyed`, `failed`) for labels and colors. So “complete” → “applied”, “pr_open”/“created” → “planning”, etc.

---

## 2. Backend lifecycle flow

### 2.1 Where status is stored (S3)

- **Location:** `lib/storage/requestsStore.ts`. Request document: `requests/{requestId}.json`. No separate “status” table; `status` is a field on the JSON document.
- **Shape:** Request has `status`, `reason`, `statusDerivedAt`, `updatedAt`, plus `pr`, `planRun`, `applyRun`, `approval`, `destroyRun`, `cleanupPr`, etc. Lifecycle events are written to **separate** objects: `logs/{requestId}/{timestamp}.json` (see `lib/logs/lifecycle.ts`). The request document also has an optional `timeline` array (e.g. cleanup PR steps), which is **not** the same as the lifecycle log events.

### 2.2 Status derivation (single place)

**File:** `lib/requests/status.ts`

```ts
export function deriveStatus(input: {
  pr?: PrInfo
  planRun?: RunInfo
  applyRun?: RunInfo
  approval?: ApprovalInfo
}): { status: RequestStatus; reason?: string }
```

- **Order of checks (priority):**  
  1) Apply run failed → `failed`  
  2) Plan run failed → `failed`  
  3) Apply run in progress/queued → `applying`  
  4) Apply run success → `complete`  
  5) PR merged → `merged`  
  6) Plan run in progress/queued → `planning`  
  7) Plan run success + approval → `approved`, else → `plan_ready`  
  8) PR open → `pr_open`  
  9) Else → `created`

- **Not in derivation:** `destroying`, `destroyed`. These exist only when written explicitly by destroy/sync.

### 2.3 Who writes `request.status`

| Trigger | Route / flow | Prev → Next (typical) |
|--------|----------------|------------------------|
| Create request | `POST /api/requests` | (none) → `created` then `planning` (before first save) |
| Dispatch plan | `POST /api/github/plan` | any → `planning` |
| Re-plan (config change) | `POST /api/requests/update` | plan_ready/approved/merged/… → `planning` |
| Approve | `POST /api/requests/[id]/approve` | plan_ready → `approved` |
| Merge PR | `POST /api/github/merge` | approved → `merged` |
| Dispatch apply | `POST /api/github/apply` | merged → `applying` |
| Dispatch destroy | `POST /api/requests/[id]/destroy` | complete/applied → `destroying` |
| Sync (GitHub + runs) | `GET /api/requests/[id]/sync` | destroying + destroy success → `destroyed`; destroying + destroy fail → `failed`; else derived → `request.status`; then apply failure override → `failed` |
| Refresh (same as sync) | `GET /api/requests/[id]/refresh` | derived → `request.status` (and persisted) |
| List (in-memory only) | `GET /api/requests` | For each request: if not destroyed/destroying, replace with `deriveStatus(...)`; if `applyRun.conclusion === "failure"` then force `failed`. **Not persisted.** |

So: **list** returns derived status in the JSON but does not write to S3. **Sync** and **refresh** fetch GitHub/runs, call `deriveStatus`, then **persist** that (and in sync, destroy transitions and apply-failure override). All other transitions are explicit writes in their handlers.

### 2.4 Lifecycle events (logging only)

**File:** `lib/logs/lifecycle.ts` — `logLifecycleEvent({ requestId, event, actor, source, data })`. Events are written to S3 `logs/{requestId}/{timestamp}.json`. They do **not** update `request.status`; they are for audit/timeline. Event names include: `request_created`, `plan_dispatched`, `configuration_updated`, `request_approved`, `pr_merged`, `apply_dispatched`, `destroy_dispatched`, etc. The **detail page** uses these events only to attach **timestamps** to timeline steps (via `/api/requests/[requestId]/logs`), not to decide step state.

---

## 3. Frontend rendering flow

### 3.1 Data sources

- **List:** `GET /api/requests` → SWR key `"/api/requests"`. Response already contains per-request `status` (derived on server for non-destroyed/destroying; see above). Refresh interval 4s. No client-side derivation.
- **Detail:** `useRequestStatus(requestId, initialRequest)` in `hooks/use-request-status.ts`. Fetches `GET /api/requests/[requestId]/sync` (not the plain GET-by-id). So the **primary** source for the detail page is the **sync** response, which returns the request with updated `status` (and runs, PR, approval, timeline). Initial data can come from server-rendered `initialRequest` (from GET-by-id), then merged with sync result.

### 3.2 useRequestStatus (polling and merge)

**File:** `hooks/use-request-status.ts`

- **SWR key:** `"/api/requests/${requestId}/sync"` when `requestId` is set.
- **Merge:** `mergeRequest(prev, next)` merges a fixed set of keys: `status`, `statusDerivedAt`, `planRun`, `applyRun`, `approval`, `pr`, `plan`, `cleanupPr`, `timeline`, `cost`. For nested objects (e.g. `planRun`), it does a shallow merge (prev spread, then next overwrites). So the **latest** sync response wins for `status` when present.
- **Refresh interval:** Dynamic. If latest (or previous) status is `complete`, `failed`, or `destroyed`, interval is 0 (no polling). Otherwise 3000 ms.
- **Result:** `request` is the merged object; detail page uses `request.status` (and related fields) from this merged object. No client-side `deriveStatus` call; status is whatever sync (or initial) returned.

### 3.3 Status normalization and badge (table and detail)

**File:** `lib/status/status-config.ts`

- **Canonical list:** `CANONICAL_STATUSES` = request_created, planning, plan_ready, approved, merged, applying, applied, destroying, destroyed, failed.
- **normalizeRequestStatus(status, context?):** Maps API status to canonical. Examples: `complete`/`applied` → `applied`; `merged` → `merged`; `applying`/`applying_changes` → `applying`; `approved`/`awaiting_approval` → `approved`; `plan_ready`/`planned` → `plan_ready`; `planning`/`pr_open`/`created`/`pending` → `planning`; plus context `isDestroyed`/`isDestroying` force `destroyed`/`destroying`. Default → `request_created`.
- **getStatusMeta(key)** / **getStatusLabel** / **getStatusColor:** By canonical key; fallback for unknown is `request_created` with muted styling.

**Table:** `app/requests/page.tsx` — Each row gets `item.status` from list API, then:

```ts
normalizeRequestStatus(item.status, {
  isDestroyed: item.status === "destroyed",
  isDestroying: item.status === "destroying",
})
```

That canonical status is passed to `<StatusIndicator variant="pill" status={...} />`.

**Detail:** Same idea: `requestStatus = memoStatusSlice?.status ?? request?.status ?? "created"`, then `canonicalStatus = normalizeRequestStatus(..., { isDestroyed, isDestroying })`, and `<StatusIndicator status={canonicalStatus} />` plus all button/visibility logic use `requestStatus` or derived booleans.

So: **one** normalization path (status-config) and **one** badge component (StatusIndicator using getStatusMeta/getStatusLabel/getStatusColor). Table and detail both go API status → normalizeRequestStatus → StatusIndicator.

### 3.4 Table: filters and sort

- **Dataset mode:** `active` (exclude `destroyed`), `drifted` (drift detected), `destroyed` (destroyed or destroying), `all`. Filter uses `row.status`.
- **Sort by status:** Uses `normalizeRequestStatus` then `getStatusLabel(canonical)` for string comparison. So sort order follows label order, not enum order.
- **Background sync:** Every 6s, up to 10 non-terminal requests are called with `GET /api/requests/{id}/sync`, then `mutateList()` so list is re-fetched. Terminal = complete, applied, failed, destroyed. So table can update status without opening the detail page.

---

## 4. Timeline logic (detail page)

### 4.1 What the “Status Timeline” is

- **Fixed steps:** submitted → planned → approved → merged → applied (see `steps` in `app/requests/[requestId]/page.tsx`).
- **Step state:** Each step is **pending**, **done**, or **current**. This is computed on the client from **current** `requestStatus` and derived booleans (isPlanReady, isApproved, isMerged, isApplied, isDestroying, isDestroyed), **not** from lifecycle log events.

### 4.2 stepState(stepKey)

```ts
function stepState(stepKey) {
  switch (stepKey) {
    case "submitted": return "done"
    case "planned":    return isPlanReady ? "done" : "pending"
    case "approved":   return isApproved ? "done" : "pending"
    case "merged":     return isMerged ? "done" : "pending"
    case "applied":    return isApplied || isDestroying || isDestroyed ? "done" : "pending"
    default:          return "pending"
  }
}
```

So the timeline is a **pure function** of current status (and pr/planRun/applyRun–derived flags). No lookup in `request.timeline` or in lifecycle logs for “is this step done”.

### 4.3 Timestamps on the timeline

- **Source:** `GET /api/requests/[requestId]/logs` returns lifecycle events from S3 `logs/{requestId}/`.
- **Mapping:** `eventToStep`: request_created→submitted, plan_dispatched→planned, request_approved→approved, pr_merged→merged, apply_dispatched→applied.
- **Usage:** `sortedEvents` (by event order then timestamp) are scanned to fill `stepTimestamps[stepKey]` with the **first** occurrence of that event’s timestamp. So the timeline **labels and done/pending** come from current status; **timestamps** come from lifecycle logs. If logs are missing or delayed, steps can show “done” with no timestamp.

### 4.4 request.timeline (document field)

- **Written:** In sync route, for cleanup PR (“Cleanup PR opened”, “Cleanup PR merged”) pushed onto `request.timeline` and persisted.
- **Used in UI:** Not used for the main Status Timeline component. The Status Timeline is steps + stepState + stepTimestamps from logs. So **request.timeline** and the **Status Timeline** can diverge: one is cleanup/PR steps, the other is the five-step lifecycle driven by status.

### 4.5 Badge vs timeline

- **Badge:** Single canonical status from `normalizeRequestStatus(requestStatus, { isDestroyed, isDestroying })`.
- **Timeline:** Same `requestStatus` (and flags) drive `stepState` and `computeStepInfo()`. So in principle they stay in sync. The only way they could diverge is if the badge used a different slice of state (e.g. only `request.status`) while the timeline used `memoStatusSlice?.status ?? request?.status`; in the current code both use the same `requestStatus` / `canonicalStatus` derived from the merged request, so they should match.

---

## 5. Status sources of truth (summary)

| Source | Authoritative for | Used by |
|--------|-------------------|--------|
| **request.status** (S3) | Stored value; only source for destroying/destroyed after they’re set | All readers when no derivation is applied; sync/refresh overwrite it with derived (except destroying/destroyed) |
| **deriveStatus(pr, planRun, applyRun, approval)** | Logical status from GitHub + runs | List (in-memory), sync, refresh, ops-metrics |
| **planRun / applyRun / destroyRun** | Run state and conclusion | deriveStatus; sync (destroy transitions); UI (plan/apply running, success, failure) |
| **approval** | Approved or not | deriveStatus; UI (approve button, isApproved) |
| **pr** (merged, open) | PR state | deriveStatus; UI (isMerged, links) |
| **Lifecycle logs** (S3 logs/) | Event history and timestamps | Detail page timeline **timestamps** only |
| **request.timeline** (array on request) | Cleanup PR steps | Stored and returned; not used for main Status Timeline |

So: for “what status do we show?”, the **authoritative** path is either (a) stored `request.status` when it’s destroying/destroyed, or (b) derived status (and list/sync/refresh can persist that). The UI never recomputes derivation; it trusts the status (and related fields) from the API and then normalizes for display.

---

## 6. File map (relevant files)

| Area | File | Role |
|------|------|------|
| **Core status** | `lib/requests/status.ts` | deriveStatus, RequestStatus type, getDisplayStatusLabel |
| **UI config** | `lib/status/status-config.ts` | CANONICAL_STATUSES, normalizeRequestStatus, getStatusMeta/Label/Color |
| **Lifecycle guard** | `lib/requests/lifecycle.ts` | validateTransition (detect-only) |
| **Storage** | `lib/storage/requestsStore.ts` | getRequest, saveRequest, updateRequest, listRequests |
| **Lifecycle logs** | `lib/logs/lifecycle.ts` | logLifecycleEvent → S3 logs/ |
| **Ops metrics** | `lib/observability/ops-metrics.ts` | normalizeStatus (derive + destroyed/destroying), buildOpsMetrics |
| **API list** | `app/api/requests/route.ts` | GET: listRequests + deriveStatus per request, apply failure override |
| **API read** | `app/api/requests/[requestId]/route.ts` | GET: getRequest only (no derivation) |
| **API sync** | `app/api/requests/[requestId]/sync/route.ts` | GET: fetch GitHub/runs, deriveStatus, destroy transitions, apply failure, persist status |
| **API refresh** | `app/api/requests/[requestId]/refresh/route.ts` | GET: fetch GitHub/runs, deriveStatus, persist status |
| **API logs** | `app/api/requests/[requestId]/logs/route.ts` | GET: list S3 logs/ for requestId, return events |
| **API plan** | `app/api/github/plan/route.ts` | POST: set status planning |
| **API apply** | `app/api/github/apply/route.ts` | POST: set status applying |
| **API destroy** | `app/api/requests/[requestId]/destroy/route.ts` | POST: set status destroying |
| **API update** | `app/api/requests/update/route.ts` | POST: set status planning (config change) |
| **API approve** | `app/api/requests/[requestId]/approve/route.ts` | POST: set status approved |
| **API merge** | `app/api/github/merge/route.ts` | POST: set status merged |
| **Hook** | `hooks/use-request-status.ts` | SWR on /sync, mergeRequest, refresh interval by status |
| **Table** | `app/requests/page.tsx` | GET /api/requests, normalizeRequestStatus, StatusIndicator, filters, background sync |
| **Detail** | `app/requests/[requestId]/page.tsx` | useRequestStatus, requestStatus, stepState, getStepCanonicalStatus, StatusIndicator, optimistic updates |
| **Badge** | `components/status/StatusIndicator.tsx` | getStatusMeta(status), dot + label |

---

## 7. Code snippets

### 7.1 deriveStatus (priority order)

```ts
// lib/requests/status.ts (simplified order)
if (applyRun?.conclusion && failedConclusions.includes(applyRun.conclusion)) return { status: "failed", ... }
if (planRun?.conclusion && failedConclusions.includes(planRun.conclusion)) return { status: "failed", ... }
if (applyRun?.status === "in_progress" || applyRun?.status === "queued") return { status: "applying", ... }
if (applyRun?.conclusion === "success") return { status: "complete", ... }
if (pr?.merged) return { status: "merged", ... }
if (planRun?.status === "in_progress" || planRun?.status === "queued") return { status: "planning", ... }
if (planRun?.conclusion === "success") return approval?.approved ? { status: "approved", ... } : { status: "plan_ready", ... }
if (pr?.open) return { status: "pr_open", ... }
return { status: "created", ... }
```

### 7.2 List: derived status + apply failure override

```ts
// app/api/requests/route.ts GET
const requests = raw.map((req) => {
  if (req.status === "destroyed" || req.status === "destroying") return req
  const derived = deriveStatus({ pr: req.pr, planRun: req.planRun, applyRun: req.applyRun, approval: req.approval })
  let status = derived.status
  if (req.applyRun?.conclusion === "failure") status = "failed"
  return { ...req, status }
})
```

### 7.3 normalizeRequestStatus (backend variants → canonical)

```ts
// lib/status/status-config.ts
export function normalizeRequestStatus(status, context?: { isDestroying?: boolean; isDestroyed?: boolean }): CanonicalStatus {
  const s = status ?? "created"
  if (context?.isDestroyed) return "destroyed"
  if (context?.isDestroying) return "destroying"
  switch (s) {
    case "complete": case "applied": return "applied"
    case "merged": return "merged"
    case "applying": case "applying_changes": return "applying"
    case "approved": case "awaiting_approval": return "approved"
    case "plan_ready": case "planned": return "plan_ready"
    case "planning": case "pr_open": case "created": case "pending": return "planning"
    // ... destroyed, destroying, failed
    default: return "request_created"
  }
}
```

### 7.4 useRequestStatus: merge and refresh interval

```ts
// hooks/use-request-status.ts
const merged = React.useMemo(() => {
  const nextMerged = mergeRequest(prevDataRef.current, data ?? null)
  prevDataRef.current = nextMerged
  return nextMerged
}, [data])

refreshInterval: (latest) => {
  const status = (latest as any)?.status ?? prevDataRef.current?.status
  if (status === "complete" || status === "failed" || status === "destroyed") return 0
  return 3000
}
```

### 7.5 Status badge (table)

```ts
// app/requests/page.tsx
<StatusIndicator
  variant="pill"
  status={normalizeRequestStatus(item.status, {
    isDestroyed: item.status === "destroyed",
    isDestroying: item.status === "destroying",
  })}
/>
```

### 7.6 Detail: requestStatus and canonicalStatus

```ts
// app/requests/[requestId]/page.tsx
const requestStatus = memoStatusSlice?.status ?? request?.status ?? "created"
// ... isApplied, isMerged, isDestroying, isDestroyed, etc. from requestStatus and runs
const canonicalStatus = normalizeRequestStatus(
  isDestroyed ? "destroyed" : isDestroying ? "destroying" : requestStatus,
  { isDestroyed, isDestroying }
)
// StatusIndicator receives canonicalStatus
```

---

## 8. Known inconsistencies and risks

1. **Two label sources:** `lib/requests/status.ts` has `getDisplayStatusLabel(status)` (used in docs/backend) and `lib/status/status-config.ts` has `getStatusLabel(canonical)` (used in UI). They map similar statuses to similar labels but are separate implementations; labels could drift (e.g. “planned” vs “Plan ready”).

2. **List vs detail source:** List uses `GET /api/requests` (derived status in response, not re-fetched per row). Detail uses `GET /api/requests/[id]/sync` and merges. So list status is “list-derived at list time”; detail status is “sync result + merge”. If user opens detail and sync runs, detail can show a newer status than the table until the table’s 4s refetch or 6s background sync runs.

3. **GET by id does not derive:** `GET /api/requests/[requestId]` returns the raw document. So if you load a request by id and never call sync, you see stored status only. The detail page uses sync (useRequestStatus), so it gets derived/destroy status; but any other consumer of GET-by-id would see possibly stale stored status.

4. **Refresh vs sync:** Refresh endpoint does the same as sync (fetch GitHub/runs, derive, persist) but is a separate route. Both write `request.status`. No single “sync entrypoint” documented; callers can use either.

5. **Optimistic updates:** Detail page sets local state (e.g. `optimisticUpdate({ status: "applying", statusDerivedAt: ... })`) before API returns. That flows into `statusSlice` and thus `requestStatus`. If the request fails, the next sync corrects it; until then the UI can show “applying” even if the backend never wrote it.

6. **applyRun.conclusion override in list:** List forces `failed` when `applyRun.conclusion === "failure"` after deriveStatus. Sync does the same override after setting derived status. So “failed” can come from either derivation (plan/apply run failed) or this explicit override. Redundant but consistent.

7. **Timeline timestamps vs step state:** Step “done”/“pending” is from current status. Timestamps are from lifecycle logs. If logs are written after a delay or not at all, the timeline can show a step as “done” with no date, or with a date from a different run.

8. **request.timeline vs Status Timeline:** request.timeline is a stored array (e.g. cleanup PR steps). The Status Timeline is a fixed five-step UI driven by status. They are not the same data; naming can cause confusion.

9. **Terminal status for polling:** useRequestStatus stops polling when status is `complete`, `failed`, or `destroyed`. It does not treat `destroying` as terminal, so destroying requests keep polling until sync sets `destroyed` (or `failed`).

10. **Lifecycle validator is detect-only:** `validateTransition` only logs invalid transitions; it does not block. So invalid transitions can still be written and appear in the UI until a later sync or manual fix.

---

*End of audit. No code changes; documentation only.*
