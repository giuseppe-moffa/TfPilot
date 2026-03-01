# Request lifecycle

End-to-end flow and status rules. Source of truth: **lib/requests/deriveLifecycleStatus.ts**.

> The lifecycle behavior described here is formally specified in [docs/INVARIANTS.md](INVARIANTS.md) and enforced by automated invariant tests.

---

## Lifecycle stages (attempt-based)

| Stage | Description |
|-------|-------------|
| **Create** | POST `/api/requests`: persist to S3, create branch `request/<requestId>`, open PR, dispatch plan. A plan attempt is **always** created (attempt 1, status `queued`, headSha/ref/actor). RunId/url may be filled when the GitHub runs list returns or later via webhook/sync; run index written when runId is available. |
| **Plan** | GitHub Actions runs plan (`-lock=false`). Webhook/sync patch the plan attempt by runId (status, conclusion, completedAt). Completion time (completedAt) is set in `patchAttemptByRunId` from `completed_at ?? updated_at` when status is completed (GitHub run API has `updated_at`, not `completed_at`). If an attempt exists without runId, webhook can attach runId by matching head_sha. Status derived → `planning` then `plan_ready`. |
| **Approve** | User/approver approves → POST approve route → `approval.approved` + approvers. |
| **Merge** | PR merged (UI or API) → merge route sets `mergedSha`; webhook can patch `pr.merged`. |
| **Apply** | User triggers apply → dispatch apply workflow; run index written; `request.runs.apply` gets attempt 1 (or next attempt on retry). Webhook/sync patch that attempt. Derived → `applying` → `applied`. |
| **Destroy** | User triggers destroy → cleanup workflow dispatched (fire-and-forget), destroy workflow dispatched; `request.runs.destroy` gets attempt 1 (or next). Cleanup PR strips TfPilot block; after destroy success, request archived to `history/`. Webhook on destroy success may trigger cleanup dispatch. |
| **Cleanup** | Workflow runs on cleanup branch; cleanup PR state patched via sync/webhook. |

**Retry:** Retry apply or retry destroy creates a **new attempt** (e.g. attempt 2). `currentAttempt` is updated; the new attempt is the only one used for “current” state. Previous attempts remain in `attempts[]` for audit.

---

## Status derivation (canonical)

Status is **not** stored as authoritative. It is computed by `deriveLifecycleStatus(request)` from:

- `pr` or `github.pr`
- **Current attempts only:** `getCurrentAttempt(request.runs, "plan"|"apply"|"destroy")` — i.e. the attempt where `attempt === currentAttempt`
- `approval`, `mergedSha`

**Derivation rules (terminality from conclusion, not status):** Apply/destroy in-flight are derived from **runId present + no conclusion** (status-agnostic). Stale destroy: runId + no conclusion + past threshold (e.g. 15 min after current attempt’s `dispatchedAt`) → `failed`. No status string is trusted for liveness.

**Priority order (exact from code):**

1. Destroy current attempt failed conclusion → `failed`
2. Destroy current attempt success → `destroyed`
3. Destroy in progress (runId + no conclusion, not stale) → `destroying`; if stale (no conclusion for >15 min after latest attempt’s `dispatchedAt`) → `failed`
4. Apply current attempt failed → `failed`
5. Plan current attempt failed → `failed`
6. Apply in-flight (runId + no conclusion) → `applying`
7. Apply success → `applied`
8. PR merged or `mergedSha` → `merged`
9. Approval approved → `approved`
10. Plan success → `plan_ready`
11. Plan running or PR open → `planning`
12. Else → `request_created`

**Canonical status set** (see `lib/status/status-config.ts`): `request_created`, `planning`, `plan_ready`, `approved`, `merged`, `applying`, `applied`, `destroying`, `destroyed`, `failed`.

**Late webhooks:** Only the **current** attempt is authoritative for derivation. If a webhook arrives out of order (e.g. “completed” after we already have a newer attempt), the patch is applied to the attempt record that matches the webhook’s runId. Monotonic rules in `patchAttemptByRunId` prevent regressing a completed attempt to in_progress; duplicate status/conclusion writes are no-ops. So late webhooks cannot regress derived state.

---

## Failure modes and retry/repair

| Situation | Behavior |
|-----------|----------|
| **State lock** | Apply/destroy workflows use concurrency group per env (state); plan uses per-request group. Lock contention is in GitHub, not TfPilot. |
| **Request lock (stale/expired)** | Each request can have a short-lived `request.lock` (holder, operation, expiresAt) to prevent concurrent plan/apply/destroy on the same request. **Expired locks are treated as inactive:** UI uses `isLockActive(lock)` (lock exists, valid expiresAt, now &lt; expiresAt) so only an active lock disables actions; backend `acquireLock` does not throw when the existing lock is expired. Sync clears expired locks: if `request.lock` exists and `expiresAt` is in the past, sync removes the lock and persists. With `DEBUG_WEBHOOKS=1`, sync logs `event=sync.lock_cleared_expired`. See **lib/requests/lock.ts** (`isLockExpired`, `isLockActive`, `acquireLock`). |
| **Webhook loss** | Sync fetches and patches when **needsReconcile(attempt)** — runId present and either conclusion or completedAt missing — for plan, apply, destroy (status-agnostic). So when the UI polls sync (e.g. on the request detail page), the attempt is updated to completed and completedAt is backfilled from run `updated_at` without manual repair. Sync also runs when `needsRepair(request)` or with `?repair=1` for other cases (e.g. missing runId resolution, PR cleanup). A noop cooldown (60s, in-memory) applies when reconcile returns non-terminal payload with no patch. GET `/api/requests/:id/sync?repair=1` forces full GitHub fetch and patches. |
| **Stale destroy** | If destroy was dispatched but no conclusion for >15 min after the current attempt’s `dispatchedAt`, `deriveLifecycleStatus` returns `failed` and `isDestroyRunStale(request)` is true. UI can show “Repair” / “Retry destroy”. Sync repair refreshes the attempt from GitHub; optional re-dispatch creates a new attempt. |
| **Cleanup dispatch failed** | After destroy success, webhook may trigger cleanup dispatch. If that fails, sync with `?repair=1` re-attempts cleanup dispatch and updates `cleanupDispatchStatus`. |

**Repair:** Sync with `?repair=1` (or `hydrate=1`) forces GitHub calls and re-patches request facts (PR, reviews, cleanup PR, and **run attempts** by runId). When `needsRepair(request)` is true, sync does the same without the query param. In addition, sync performs GitHub run fetch for any current attempt (plan/apply/destroy) that satisfies **needsReconcile** (runId present and either conclusion or completedAt missing), so "stuck destroying" (or planning/applying) and missing completion time converge within 1–2 poll intervals without manual repair. See **docs/OPERATIONS.md**.

---

## Stale destroy handling (code)

- `DESTROY_STALE_MINUTES = 15` in `deriveLifecycleStatus.ts`.
- `isDestroyRunStale(request)` is true when the current destroy attempt exists, is in_progress/queued with no conclusion, and more than 15 minutes have passed since that attempt’s `dispatchedAt`.
- UI uses this to show “Repair” and treat as not actively destroying.
