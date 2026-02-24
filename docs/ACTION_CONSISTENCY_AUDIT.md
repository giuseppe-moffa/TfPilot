# Full Action Consistency Audit — Approve / Merge / Apply / Destroy

**Date:** 2025-02-23  
**Scope:** Backend routes, lifecycle derivation, UI flow, button disabling, timeline, error/retry, polling.  
**Mode:** Read-only analysis; no code changes.

---

## Executive Summary

| Metric | Score | Notes |
|--------|--------|--------|
| **Overall consistency score** | **7/10** | Same runAction/forceSync/ActionProgressDialog; backend lock/idempotency and error surfacing differ. |
| **Major inconsistencies** | 3 | Approve/Merge: no lock; Approve: no API error in UI; Merge modal guard uses stored `status`. |
| **Minor inconsistencies** | 4 | Response shape (success/request vs ok); Destroy 2.5s delay; Approve guard uses stored status. |
| **Risks** | 2 | Double-approve/merge if no idempotency key; Merge "Yes" no-op if stored status ≠ "approved". |

---

## 1. Backend Route Behavior

### 1.1 Approve

| Aspect | Detail |
|--------|--------|
| **File** | `app/api/requests/[requestId]/approve/route.ts` |
| **Handler** | `POST`, params `requestId` from route |
| **Idempotency** | ✅ `getIdempotencyKey`, `assertIdempotentOrRecord` for operation `"approve"`. Replay returns `{ success: true, request: updated }` (re-fetches request). |
| **Lock** | ❌ **No lock.** No `acquireLock` / `releaseLock`. |
| **Lock release on failure** | N/A |
| **Facts persisted** | `approval: { approved: true, approvers }`, `timeline` (step "Approved"), `statusDerivedAt`, `updatedAt`. Does **not** write `status`. |
| **deriveLifecycleStatus** | ✅ Transition to "approved" via `approval?.approved`; route persists that. Immediate. |
| **Response shape** | `{ success: true, request: updated }` (200) or `{ success: false, error }` (4xx/5xx). |
| **Errors** | 400/401/403/404/500; generic "Failed to approve request" in catch. |

**Snippet (persistence):**

```ts
// approve/route.ts L100–106
const updated = await updateRequest(requestId, (current) => ({
  ...current,
  approval: { approved: true, approvers: current.approval?.approvers ?? [] },
  statusDerivedAt: nowIso,
  updatedAt: nowIso,
  timeline: nextTimeline,
}))
```

---

### 1.2 Merge

| Aspect | Detail |
|--------|--------|
| **File** | `app/api/github/merge/route.ts` |
| **Handler** | `POST`, body `{ requestId }` |
| **Idempotency** | ✅ Same pattern: `assertIdempotentOrRecord` for `"merge"`. Replay returns `{ ok: true, mergedSha }`. |
| **Lock** | ❌ **No lock.** |
| **Lock release on failure** | N/A |
| **Facts persisted** | `mergedSha`, `pr: { merged: true, open: false, state: "closed", mergedAt, mergeCommitSha }`, `updatedAt`. No `status` write. |
| **deriveLifecycleStatus** | ✅ "merged" from `pr?.merged` or `request.mergedSha`; both persisted. Immediate. |
| **Response shape** | `{ ok: true, mergedSha }` or `{ error }` (4xx/5xx). |
| **Errors** | 400/401/403/404/409/500; GitHub error message parsed and returned. |

**Snippet (persistence):**

```ts
// github/merge/route.ts L214–228
await updateRequest(request.id, (current) => ({
  mergedSha,
  pr: {
    ...(current.pr ?? {}),
    number: ..., url: ...,
    merged: true, open: false, state: "closed",
    mergedAt: nowIso,
    ...(mergedSha && { mergeCommitSha: mergedSha }),
  },
  prNumber: ..., prUrl: ..., updatedAt: nowIso,
}))
```

---

### 1.3 Apply

| Aspect | Detail |
|--------|--------|
| **File** | `app/api/github/apply/route.ts` |
| **Handler** | `POST`, body `{ requestId }` |
| **Idempotency** | ✅ Same pattern for `"apply"`. Replay returns `{ ok: true }`. |
| **Lock** | ✅ `acquireLock` before dispatch; `releaseLock(afterApply, holder)` after persisting applyRun; on catch, best-effort release. |
| **Lock release on failure** | ✅ In catch: get current request, `releaseLock(current, holder)`, updateRequest(patch). |
| **Pre-condition** | `isMerged` = `request.status === "merged"` \|\| `request.pr?.merged === true` \|\| `!!request.mergedSha`. |
| **Facts persisted** | `applyTriggeredAt`, `applyRunId`, `applyRunUrl`, `applyRun: { runId, url, status: "in_progress" }`, `updatedAt`. No `status` write. |
| **deriveLifecycleStatus** | ✅ "applying" from `applyRun.status`, "applied" from `applyRun.conclusion`; route sets status in_progress. Immediate. |
| **Response shape** | `{ ok: true }` or `{ error }`. |
| **Errors** | 400/401/403/404/409/500; "Failed to dispatch apply" in catch. |

---

### 1.4 Destroy

| Aspect | Detail |
|--------|--------|
| **File** | `app/api/requests/[requestId]/destroy/route.ts` |
| **Handler** | `POST`, params `requestId` |
| **Idempotency** | ✅ Same pattern for `"destroy"`. Replay returns `{ ok: true, destroyRunId, destroyRunUrl, request }`. |
| **Lock** | ✅ `acquireLock` before dispatch; `releaseLock(updated, holder)` after persisting destroyRun; on catch, best-effort release. |
| **Lock release on failure** | ✅ Same as apply. |
| **Facts persisted** | `destroyRun: { runId, url, status: "in_progress" }`, `cleanupPr`, `statusDerivedAt`, `updatedAt`. No `status` write. |
| **deriveLifecycleStatus** | ✅ "destroying" / "destroyed" / "failed" from `destroyRun`; route sets status in_progress. Immediate. |
| **Response shape** | `{ ok: true, destroyRunId, destroyRunUrl, request: updated }` or `{ error }`. |
| **Errors** | 400/401/403/404/409/500; "Failed to dispatch destroy" in catch. |
| **Special** | 2.5s delay after dispatch before fetching workflow runs (to get new run first). |

---

### 1.5 Backend consistency summary

| Area | Approve | Merge | Apply | Destroy | Notes |
|------|--------|-------|--------|--------|-------|
| Idempotency | ✅ | ✅ | ✅ | ✅ | Same pattern; replay returns success. |
| Lock | ❌ | ❌ | ✅ | ✅ | Approve/Merge have no lock. |
| Lock release on failure | N/A | N/A | ✅ | ✅ | Apply/Destroy release in catch. |
| Facts persisted before response | ✅ | ✅ | ✅ | ✅ | All persist then return. |
| No status writes | ✅ | ✅ | ✅ | ✅ | Only facts; status is derived (sync writes derived status). |
| Error response shape | `success: false, error` | `error` | `error` | `error` | Approve uses `success`; others use `ok`/`error`. |

---

## 2. Derived Lifecycle Correctness

**File:** `lib/requests/deriveLifecycleStatus.ts`

| Action | Facts that trigger transition | Persisted by route? | Relies on polling? |
|--------|------------------------------|----------------------|----------------------|
| **Approve** | `approval?.approved` | ✅ Yes (`approval: { approved: true }`) | ❌ No |
| **Merge** | `pr?.merged` or `request.mergedSha` | ✅ Yes (both) | ❌ No |
| **Apply** | `applyRun.status` / `applyRun.conclusion` | ✅ Yes (status in_progress; conclusion later via sync/workflow) | ⚠️ Conclusion comes from GitHub/sync; dispatch is immediate. |
| **Destroy** | `destroyRun.status` / `destroyRun.conclusion` | ✅ Yes (status in_progress; conclusion later) | ⚠️ Same as apply. |

- All four actions persist the facts that derivation needs for the *immediate* next state (approved, merged, applying, destroying). Apply/Destroy final state (applied/destroyed) depends on workflow completion and sync, which is expected.
- No action is "slower to derive" due to missing facts; Merge was fixed so `mergedSha` and `pr.merged` are both persisted.

---

## 3. UI Mutation Flow

**File:** `app/requests/[requestId]/page.tsx`

| Action | Handler | Uses runAction? | forceSync() awaited? | Dialog closes immediately? | ActionProgressDialog? |
|--------|---------|------------------|------------------------|-----------------------------|------------------------|
| **Approve** | `handleApproveConfirm()` | ✅ Yes | ✅ Yes (inside runAction) | ✅ Yes (closeDialog) | ✅ Yes |
| **Merge** | Inline in Merge dialog onClick | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Apply** | `handleApplyOnly()` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Destroy** | Inline in Destroy dialog onClick | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

- **runAction pattern:** All four: set in-flight state → `setActionProgress({ op, state: "running" })` → `closeDialog()` → store retry in `actionRetryRef` → `await fn()` → `await forceSync()` → success: 1s then clear progress; error: set progress error; finally: clear in-flight.
- **mutateStatus:** Used only for `handlePatchSubmit` (update config) and `handleUpdateBranch` (update branch), and for `onRefresh` in SuggestionPanel. Not used by Approve/Merge/Apply/Destroy after the unified flow.
- **Action-specific timers:** No 400ms/2000ms on these actions; only 1s success auto-dismiss in runAction.

**Approve handler (guard):**

```ts
// L756–767
if (request as any).status === "approved" || (request as any).status === "applied" → return (no runAction)
```

**Merge onClick guard:**

```ts
// L2188
if (!requestId || !request || (request as any).status !== "approved") return
```

So Merge "Yes" uses **stored** `request.status`, not derived. If sync hasn’t run yet after approve, `request.status` may still be undefined or old; then "Yes, merge" does nothing (no runAction).

---

## 4. Button Disabling Logic

**File:** `app/requests/[requestId]/page.tsx` — `isActionDisabled(action)` (L832–880).

| Condition | Approve | Merge | Apply | Destroy |
|-----------|---------|--------|--------|---------|
| **hasLock** | ✅ | ✅ | ✅ | ✅ |
| **In-flight state** | isApproving | mergeStatus === "pending" | isApplying | destroyInFlight |
| **!request** | ✅ | ✅ | — | — |
| **Derived status** | requestStatus === "approved", isMerged, isApplied, isDestroying, isDestroyed, isApplyingDerived, isFailed | requestStatus !== "approved", isMerged, ... | !isMerged, isApplied, ... | isDestroying, isDestroyed, !isApplied, !!isApplying |
| **Facts (pr.merged / mergedSha)** | — | ✅ isMerged (includes prMerged) | ✅ isMerged | — |
| **applyRun / destroyRun** | — | — | isApplyingDerived (applyRun) | isDestroying (destroyRun) |
| **canDestroy** | — | — | — | ✅ |
| **isPlanReady** | ✅ (required to enable Approve) | — | — | — |

- **Merge:** Disabled when `isMerged` (prMerged \|\| requestStatus === "merged" \|\| ...). So once merged, button stays disabled via facts.
- **Apply:** Disabled when !isMerged; uses same isMerged as Merge.
- **Destroy:** Does not check `actionProgress?.op === "destroy"` in isActionDisabled; it does check `destroyInFlight`. So while ActionProgressDialog is showing "running", destroy is disabled by destroyInFlight. ✅
- **Approve:** Does not explicitly check `actionProgress?.op === "approve"`; relies on isApproving. ✅

**Inconsistency:** Merge and Approve dialogs use **stored** `request.status` in their guards (Merge: "Yes" only runs if `request.status !== "approved"`; Approve: handleApproveConfirm returns early if `request.status === "approved"`). Rest of UI uses derived status. If stored status is lagging, Merge "Yes" can be a no-op.

---

## 5. Timeline Update Trigger

- **forceSync:** Implemented in `use-request-status.ts` as nonce bump + SWR revalidate; when the sync request completes, `request` updates and component re-renders.
- **Timeline:** Built from `request` (e.g. `sortedEvents` from logs, step labels from lifecycle). So timeline updates when `request` from useRequestStatus updates (i.e. after forceSync completes).
- **Derived status:** Page uses `requestStatus = deriveLifecycleStatus(request)`; timeline/step state use that and `actionProgress?.op`. So timeline reflects new state as soon as forceSync returns the updated request (with new facts).
- No action relies on polling alone to show completion; forceSync is sufficient. Polling continues per `getSyncPollingInterval(request, tabHidden)` (uses stored `request.status` from last sync).

---

## 6. Error + Retry Behavior

| Action | Error in ActionProgressDialog? | Source of message | Retry path | Lock released on failure? |
|--------|--------------------------------|--------------------|------------|----------------------------|
| **Approve** | ✅ Yes | Generic "Approve failed" (no API body) | ✅ onRetry → runAction | N/A (no lock) |
| **Merge** | ✅ Yes | `data?.error ?? "Failed to merge PR"` | ✅ onRetry | N/A |
| **Apply** | ✅ Yes | `(data as { error?: string })?.error ?? "Failed to dispatch apply"` | ✅ onRetry | ✅ Yes (apply route catch) |
| **Destroy** | ✅ Yes | `(err as { error?: string })?.error ?? "Failed to dispatch destroy"` | ✅ onRetry | ✅ Yes |

- All four show error state in ActionProgressDialog with Retry + Dismiss. Retry reuses `actionRetryRef.current` and calls runAction again.
- **Inconsistency:** Approve is the only one that does not pass API error body to the user; it always shows "Approve failed".

---

## 7. Polling Interaction

- **useRequestStatus** uses SWR with `refreshInterval: getSyncPollingInterval(latest, tabHiddenRef.current)`. Interval depends on stored `request.status` (terminal → 0, active → ACTIVE_MS, else IDLE_MS). So polling uses the **stored** status written by sync, not client-side derived status.
- Actions do not depend on polling to update state; they call forceSync after the mutation. So after Approve/Merge/Apply/Destroy, the next frame has updated request from forceSync; polling then continues with that state.
- **Minor:** Polling interval is driven by `request.status` (set by sync). If sync never ran after an action, polling interval would still be based on old status until the next revalidate. In practice forceSync runs after every action, so this is acceptable.

---

## Per-Action Breakdown

### Approve

| Area | Detail |
|------|--------|
| **Backend** | `app/api/requests/[requestId]/approve/route.ts`. Idempotency ✅. No lock. Persists `approval`, timeline, `statusDerivedAt`. |
| **Lifecycle facts** | `approval?.approved` → "approved". Persisted by route. |
| **UI flow** | handleApproveConfirm → runAction("approve", fetch approve, closeDialog). forceSync ✅. Dialog confirm-only; ActionProgressDialog for progress/error. |
| **Disable rules** | hasLock, isApproving, !request, !isPlanReady, requestStatus === "approved", isMerged, isApplied, isDestroying, isDestroyed, isApplyingDerived, isFailed. |
| **Issues** | 1) No lock (concurrent approve possible without idempotency key). 2) Error message never shows API body ("Approve failed" only). 3) handleApproveConfirm guard uses stored `request.status` (could block if status not yet set). |

### Merge

| Area | Detail |
|------|--------|
| **Backend** | `app/api/github/merge/route.ts`. Idempotency ✅. No lock. Persists mergedSha, pr.merged, pr.state, mergedAt, mergeCommitSha. |
| **Lifecycle facts** | `pr?.merged` or `mergedSha` → "merged". Both persisted. |
| **UI flow** | Inline runAction("merge", fetch merge, closeDialog). forceSync ✅. Confirm-only dialog; ActionProgressDialog for progress/error. |
| **Disable rules** | hasLock, mergeStatus === "pending", !request, requestStatus !== "approved", isMerged, isDestroying, isDestroyed, isFailed. |
| **Issues** | 1) No lock. 2) **Critical:** "Yes, merge" guard is `(request as any).status !== "approved"`. If stored status is not yet "approved" (e.g. before first sync after approve), button can be enabled but click does nothing. Should use derived status. |

### Apply

| Area | Detail |
|------|--------|
| **Backend** | `app/api/github/apply/route.ts`. Idempotency ✅. Lock ✅, release on success and on failure. Merged check uses status + pr.merged + mergedSha. Persists applyRun (in_progress), applyTriggeredAt, etc. |
| **Lifecycle facts** | applyRun.status / conclusion → "applying" / "applied". Persisted in_progress; conclusion from workflow/sync. |
| **UI flow** | handleApplyOnly → runAction("apply", fetch /api/github/apply, closeDialog). forceSync ✅. Confirm-only; ActionProgressDialog. |
| **Disable rules** | hasLock, isApplying, !isMerged, isApplied, isApplyingDerived, isDestroying, isDestroyed, isFailed. |
| **Issues** | None major. handleApplyOnly guard uses deriveLifecycleStatus(request) === "merged" ✅. |

### Destroy

| Area | Detail |
|------|--------|
| **Backend** | `app/api/requests/[requestId]/destroy/route.ts`. Idempotency ✅. Lock ✅, release on success and failure. Persists destroyRun (in_progress), cleanupPr, statusDerivedAt. 2.5s delay before fetching run list. |
| **Lifecycle facts** | destroyRun.status / conclusion → "destroying" / "destroyed" / "failed". Persisted. |
| **UI flow** | Inline runAction("destroy", fetch destroy, closeDialog). forceSync ✅. Type-to-confirm "destroy"; ActionProgressDialog. |
| **Disable rules** | hasLock, destroyInFlight, isDestroying, isDestroyed, !isApplied, !canDestroy, isApplying. |
| **Issues** | 2.5s delay is action-specific (no equivalent in Apply). Minor. |

---

## Cross-Action Comparison Table

| Area | Approve | Merge | Apply | Destroy | Notes |
|------|--------|-------|--------|--------|------|
| Route path | /api/requests/[id]/approve | /api/github/merge | /api/github/apply | /api/requests/[id]/destroy | Different hosts (requests vs github). |
| Idempotency | ✅ | ✅ | ✅ | ✅ | Same pattern. |
| Lock | ❌ | ❌ | ✅ | ✅ | Inconsistent. |
| Facts persisted | approval, timeline | mergedSha, pr | applyRun | destroyRun, cleanupPr | All sufficient for derivation. |
| runAction | ✅ | ✅ | ✅ | ✅ | Same. |
| forceSync | ✅ | ✅ | ✅ | ✅ | Same. |
| Dialog | Confirm only | Confirm only | Confirm only | Confirm + type "destroy" | Destroy has extra step. |
| ActionProgressDialog | ✅ | ✅ | ✅ | ✅ | Same. |
| API error in UI | ❌ | ✅ | ✅ | ✅ | Approve generic only. |
| Confirm guard | stored status | stored status | derived status | N/A (type-to-confirm) | Merge/Approve guards differ from Apply. |
| Disable uses facts | isApproved etc. | isMerged (prMerged) | isMerged | canDestroy, isApplied | Consistent. |

---

## Identified Gaps (by severity)

### 🔴 Critical

1. **Merge "Yes" no-op when stored status ≠ "approved"**  
   Merge dialog onClick: `if ((request as any).status !== "approved") return`. If the client has not yet received a doc with `status === "approved"` (e.g. right after approve, before forceSync), the Merge button can be enabled (derived status is "approved") but "Yes, merge" does nothing. **Recommendation:** Use derived status, e.g. `deriveLifecycleStatus(request) !== "approved"` → return, or allow when `requestStatus === "approved"`.

### 🟠 Medium

2. **Approve and Merge have no lock**  
   Concurrent requests (e.g. double-click or two tabs) can result in two approve or two merge calls. Idempotency (with same key) prevents double effect only if the client sends the same idempotency key; if no key is sent, both can run. **Recommendation:** Add acquireLock/releaseLock to approve and merge routes for consistency and to prevent races when idempotency key is missing.

3. **Approve error message never shows API body**  
   Handler: `.then((r) => { if (!r.ok) throw new Error("Approve failed") })`. User never sees server message (e.g. "Approval not permitted for your role"). **Recommendation:** Parse res.json() and throw new Error(data?.error ?? "Approve failed").

### 🟡 Minor

4. **Response shape inconsistency**  
   Approve returns `{ success: true, request }`; Merge/Apply return `{ ok: true }` (and Destroy `{ ok: true, request }`). Client does not rely on success/request for these flows; only for error. Minor for behavior, but could be unified.

5. **handleApproveConfirm guard uses stored status**  
   Guard uses `(request as any).status === "approved"` or `"applied"` to skip. Prefer derived status so behavior matches what the user sees (e.g. approve button disabled when derived status is approved).

6. **Destroy 2.5s delay**  
   Only destroy route has an explicit delay (2.5s) before fetching workflow runs. Apply does not. Consider documenting or aligning (e.g. same short delay for apply if needed for run discovery).

7. **Polling interval uses stored status**  
   `getSyncPollingInterval(request, tabHidden)` uses `request.status`. If sync hasn’t run, interval is based on old status. forceSync after each action mitigates; could use deriveLifecycleStatus in polling lib for full consistency.

---

## Recommended Fix Plan

### 1️⃣ Backend consistency

- Add **lock** to Approve and Merge: `acquireLock` after idempotency, before GitHub call; `releaseLock` after success; in catch, best-effort release (same as Apply/Destroy).
- Optionally unify response shape: e.g. all return `{ ok: true, ... }` and `{ error: string }` for errors.

### 2️⃣ UI consistency

- **Merge dialog:** Change "Yes, merge" guard from `(request as any).status !== "approved"` to derived status, e.g. `deriveLifecycleStatus(request) !== "approved"` (and still require requestId/request).
- **Approve:** In handleApproveConfirm, use derived status for guard: e.g. if `deriveLifecycleStatus(request) === "approved"` or `=== "applied"` then return.
- **Approve error:** In approve fetch handler, do `const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data?.error ?? "Approve failed")`.

### 3️⃣ Lifecycle derivation

- No change required; all actions persist the facts needed for immediate derivation. Optional: document that applyRun/destroyRun conclusion is filled by sync/workflow completion.

### 4️⃣ Button rules

- No change required; isActionDisabled already uses isMerged (facts), requestStatus, and in-flight flags. Optional: add explicit `actionProgress?.op === "merge"` to Merge disable for symmetry with timeline (already effectively disabled via mergeStatus === "pending").

### 5️⃣ Observability

- Ensure all four routes log lifecycle events (approve ✅, merge ✅, apply ✅, destroy ✅).
- Optionally add a short comment in Merge route that lock was intentionally omitted (if not added) so future readers know the design choice.

---

## Confidence Check

| Criterion | Result | Notes |
|-----------|--------|--------|
| **Deterministic lifecycle** | ✔️ | deriveLifecycleStatus is pure; facts persisted by each route; sync writes derived status. |
| **Single source of truth** | ✔️ | Status is derived from facts; only sync writes `status` (from derivation). |
| **Race safe** | ❌ | Approve and Merge can run concurrently without lock; idempotency helps only when key is sent. |
| **UX consistent** | ✔️ | One runAction flow, one ActionProgressDialog, same forceSync; Approve error message and Merge guard are the only UX gaps. |

---

## File Reference Summary

| File | Purpose |
|------|--------|
| `app/api/requests/[requestId]/approve/route.ts` | Approve POST; idempotency; no lock; persists approval + timeline. |
| `app/api/github/merge/route.ts` | Merge POST; idempotency; no lock; persists mergedSha + pr. |
| `app/api/github/apply/route.ts` | Apply POST; idempotency; lock; merged check; persists applyRun. |
| `app/api/requests/[requestId]/destroy/route.ts` | Destroy POST; idempotency; lock; persists destroyRun; 2.5s delay. |
| `lib/requests/deriveLifecycleStatus.ts` | Canonical status from facts; includes mergedSha. |
| `lib/requests/lock.ts` | acquireLock / releaseLock. |
| `lib/requests/idempotency.ts` | assertIdempotentOrRecord. |
| `app/requests/[requestId]/page.tsx` | runAction, handlers, isActionDisabled, dialogs, ActionProgressDialog. |
| `hooks/use-request-status.ts` | forceSync, SWR key with nonce, polling interval. |
| `app/api/requests/[requestId]/sync/route.ts` | Enriches request; sets request.status = deriveLifecycleStatus(request); updateRequest. |
| `components/action-progress-dialog.tsx` | running/success/error; errorMessage; onRetry; onDismiss. |
