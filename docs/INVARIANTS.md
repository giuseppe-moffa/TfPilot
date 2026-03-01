# Formal invariants (lifecycle engine)

This document states the **invariants** that the current TfPilot lifecycle engine guarantees. It is for reference and regression prevention only: no architecture or code changes. Future changes MUST NOT violate these invariants.

**Storage changes may move enforcement points, but MUST NOT change Tier A invariants.**

---

## Purpose

- Capture the **contract** of the existing lifecycle, sync, and audit behaviour in a testable form.
- Give future changes a checklist: if a change breaks an invariant, it is a regression.
- Map each invariant to the **enforcement points** in code so maintainers know where the guarantee is implemented.

---

## Glossary

| Term | Definition |
|------|-------------|
| **Attempt** | A single run record in `request.runs.{plan,apply,destroy}.attempts[]`. Has `attempt` (number), optional `runId`, `status`, `conclusion`, `dispatchedAt`, optional `completedAt`, etc. |
| **runId** | GitHub Actions workflow run ID. Set when the run is known (from list, webhook, or sync). May be missing immediately after dispatch. |
| **dispatchedAt** | ISO 8601 timestamp when the attempt was created (dispatch time). Always set on the attempt record. |
| **completedAt** | ISO 8601 timestamp when the run completed. Set by `patchAttemptByRunId` from payload; never cleared once set. |
| **conclusion** | Terminal outcome of the run: e.g. `success`, `failure`, `cancelled`. From GitHub payload; never cleared once set. |
| **Monotonic patch** | An update that never regresses state: e.g. does not clear `completedAt` or `conclusion`, does not overwrite a completed attempt with in_progress/queued. |
| **Reconcile** | Sync path that fetches a single run by `runId` (GET `/repos/{owner}/{repo}/actions/runs/{runId}`) and patches the matching attempt. Triggered when the current attempt satisfies `needsReconcile`. |

---

## Core lifecycle invariants

- **INV-CORE-1** The system **MUST** store run execution state only under `request.runs.plan`, `request.runs.apply`, and `request.runs.destroy`, each with `currentAttempt` (number) and `attempts` (array of attempt records). No other authoritative run state exists.

- **INV-CORE-2** The system **MUST** derive display status from facts via `deriveLifecycleStatus(request)`. Status **MUST NOT** be stored as the source of truth; it is computed from current attempts, PR, approval, mergedSha, etc.

- **INV-CORE-3** Only `persistDispatchAttempt` (or equivalent dispatch path) **MUST** set or increment `runs[kind].currentAttempt` and append to `attempts[]`. Webhook and sync **MUST NOT** change `currentAttempt` or create new attempts; they only update existing attempt records by runId.

- **INV-CORE-4** The “current” attempt for a kind is the one where `attempt === runs[kind].currentAttempt`. All derivation and reconciliation **MUST** use this current attempt for that kind.

---

## Reconciliation invariants

- **INV-REC-1** `needsReconcile(attempt)` **MUST** be true exactly when `attempt.runId != null` and (`attempt.conclusion` is null/undefined **or** `attempt.completedAt` is null/undefined). This allows backfilling completion time when conclusion exists but completedAt is missing.

- **INV-REC-2** Sync **MUST** perform a reconcile run fetch for a kind only when the current attempt for that kind exists and satisfies `needsReconcile(attempt)` and is not in the noop cooldown window.

- **INV-REC-3** The reconcile run fetch (GET `/repos/{owner}/{repo}/actions/runs/{runId}`) **MUST** use `bypassCache: true` so the response is not served from cache. Other GitHub GETs (e.g. list runs, PR) **MAY** use cache.

- **INV-REC-4** When a reconcile fetch returns a non-terminal payload and the patch produces no change, sync **SHOULD** apply a noop cooldown (e.g. 60s in-memory) for that (requestId, kind, runId) to avoid tight polling.

---

## Completion time contract

- **INV-COMP-1** Completion time for an attempt **MUST** be set in exactly one place: `patchAttemptByRunId`. The rule **MUST** be: if the attempt already has `completedAt`, keep it; else if the payload has `status === "completed"`, set `completedAt` from `payload.completed_at ?? payload.updated_at` (non-empty string only). The GitHub Actions run API does not return `completed_at`; it returns `updated_at`, which is used as the completion time when the run is completed.

- **INV-COMP-2** `patchAttemptByRunId` **MUST NOT** clear `completedAt` once it is set. It **MUST** only set or retain it.

- **INV-COMP-3** Callers (webhook, sync) **MUST** pass the run payload including `status`, `conclusion`, `completed_at` (if present), and `updated_at` so that `patchAttemptByRunId` can apply the single-source rule.

---

## Locking invariants

- **INV-LOCK-1** A lock is **active** if and only if `isLockActive(lock, now)` is true: lock exists, has valid `expiresAt`, and `now < expiresAt`. Expired or missing lock **MUST** be treated as no lock.

- **INV-LOCK-2** The UI **MUST** disable plan/apply/destroy actions only when the request has an **active** lock (e.g. using `isLockActive(request.lock)`). Expired lock **MUST NOT** disable actions.

- **INV-LOCK-3** Sync **MUST** clear `request.lock` when the lock exists and `expiresAt` is in the past, and persist the updated request, so that stale locks do not persist.

- **INV-LOCK-4** `acquireLock` **MUST** treat an expired or missing lock as “no lock” and allow acquiring; it **MUST** throw `LockConflictError` only when a **non-expired** lock is held by a different holder.

---

## Audit / timeline invariants

- **INV-AUDIT-1** Audit events (Lifecycle History and audit export) **MUST** be produced by a single function: `buildAuditEvents(request, nowIso?)`. They **MUST** be derived from request facts only (no external live calls inside the builder).

- **INV-AUDIT-2** For the same request and optional `nowIso`, `buildAuditEvents` **MUST** be deterministic and replayable: same input **MUST** yield the same ordered list of events.

- **INV-AUDIT-3** Event ordering **MUST** be well-defined (e.g. by `at` and a fixed priority for ties). Export and UI **MUST** use the same event list (e.g. same slice or same source) so that export and UI stay in sync.

---

## UI / action disablement invariants (backed by request facts)

- **INV-UI-1** Plan/Apply/Destroy actions **MUST** be disabled when the request has an active lock (see INV-LOCK-2). The only source for “is locked” **MUST** be `request.lock` plus `isLockActive(lock)`.

- **INV-UI-2** Action enablement (e.g. “Apply” available only when status is merged) **MUST** be derived from the same facts used by `deriveLifecycleStatus` (e.g. PR merged, current attempt state). No separate stored “can apply” flag.

---

## Violation examples

These are examples of **regressions** that would violate the invariants above.

| Violation | What it looks like |
|-----------|--------------------|
| Clearing completedAt | An attempt previously has `completedAt` set; after webhook or sync it is undefined. |
| Reconcile never runs for missing completedAt | Attempt has `runId`, `conclusion: "success"`, but `completedAt` missing; sync does not fetch the run or patch. |
| Reconcile uses cached run | Reconcile fetch returns stale run payload (e.g. no `updated_at` or old status); completedAt never gets set. |
| needsReconcile too strict | `needsReconcile` returns false when only `completedAt` is missing (conclusion present); reconcile never runs. |
| Status stored | Request document gains a stored `status` field that is used as source of truth instead of `deriveLifecycleStatus`. |
| currentAttempt changed by sync/webhook | Sync or webhook increments `currentAttempt` or appends to `attempts` instead of only patching by runId. |
| Expired lock blocks UI | UI disables actions when `request.lock` exists but is expired (expiresAt in the past). |
| Sync does not clear expired lock | Request has lock with past `expiresAt`; after sync the lock is still present and never cleared. |
| Non-deterministic audit | Same request produces different `buildAuditEvents` output on two calls. |
| Audit from live API | Lifecycle History or export calls GitHub (or another service) inside the audit builder instead of using only request facts. |

---

## Enforcement points

### Tier A: Semantic invariants (must hold forever)

These are the logical guarantees. They must hold regardless of where or how request data is stored. Any storage or implementation migration MUST preserve them.

- **Run state shape:** Run execution state lives only under a single runs structure (plan/apply/destroy, each with currentAttempt + attempts). Only the dispatch path creates/increments currentAttempt and appends attempts; webhook and sync only patch existing attempts by runId.
- **Status derivation:** Display status is always derived from facts, never stored as source of truth.
- **Reconcile eligibility:** An attempt is eligible for reconcile iff it has runId and (conclusion or completedAt) is missing. Reconcile fetch uses an uncached run response. Noop cooldown applies when reconcile yields no change and payload is non-terminal.
- **Completion time:** One function/contract sets completion time; rule is keep existing completedAt else set from completed_at ?? updated_at when status=completed; completedAt is never cleared.
- **Locks:** “Active” is defined as lock exists, valid expiresAt, now &lt; expiresAt. UI disables actions only for active lock. Sync clears expired lock. Acquire treats expired/missing as no lock.
- **Audit:** One deterministic builder produces audit events from request facts only; export and UI use the same source.
- **UI disablement:** Action disable/enable is driven only by request facts (e.g. active lock, derived status).

### Tier B: Current enforcement points (implementation detail)

*Will change during storage migration.* The table below maps each invariant to the current file(s) and function(s) where it is enforced. When storage or code layout changes, update this table so that Tier A invariants still hold at the new enforcement points.

| Invariant(s) | File(s) / function(s) |
|--------------|------------------------|
| INV-CORE-1, INV-CORE-3, INV-CORE-4 | `lib/requests/runsModel.ts`: `ensureRuns`, `persistDispatchAttempt`, `getCurrentAttemptStrict`; storage only in `request.runs.{plan,apply,destroy}`. |
| INV-CORE-2 | `lib/requests/deriveLifecycleStatus.ts`: `deriveLifecycleStatus`. |
| INV-REC-1 | `lib/requests/runsModel.ts`: `needsReconcile`. |
| INV-REC-2 | `app/api/requests/[requestId]/sync/route.ts`: gates that call `needsReconcile(planAttempt)` etc. and only then fetch run and call `patchAttemptByRunId`. |
| INV-REC-3 | `lib/github/rateAware.ts`: `bypassCache` option; `app/api/requests/[requestId]/sync/route.ts`: reconcile run fetch calls pass `bypassCache: true`. |
| INV-REC-4 | `app/api/requests/[requestId]/sync/route.ts`: `setReconcileCooldown`, `isInReconcileCooldown`, `reconcileNoopAt`. |
| INV-COMP-1, INV-COMP-2, INV-COMP-3 | `lib/requests/runsModel.ts`: `patchAttemptByRunId` (single-source rule, never clear completedAt); callers in `lib/requests/patchRequestFacts.ts` and `app/api/requests/[requestId]/sync/route.ts` pass `updated_at` and `completed_at`. |
| INV-LOCK-1, INV-LOCK-4 | `lib/requests/lock.ts`: `isLockActive`, `isLockExpired`, `acquireLock`. |
| INV-LOCK-2 | UI that disables actions: must use `isLockActive(request.lock)` (or equivalent). |
| INV-LOCK-3 | `app/api/requests/[requestId]/sync/route.ts`: start-of-sync logic that clears `request.lock` when expired and persists. |
| INV-AUDIT-1, INV-AUDIT-2, INV-AUDIT-3 | `lib/requests/auditEvents.ts`: `buildAuditEvents`; `app/api/requests/[requestId]/audit-export/route.ts` and request detail UI use it. |
| INV-UI-1, INV-UI-2 | Request detail (and any) UI that gates plan/apply/destroy on lock and status; must use request facts + `deriveLifecycleStatus` / `isLockActive`. |

---

## Test checklist

Concrete tests that would catch regressions of the above invariants. (~10 items.)

1. **needsReconcile — conclusion missing:** Given an attempt with `runId` set and `conclusion` null, `needsReconcile(attempt)` returns true.
2. **needsReconcile — completedAt missing:** Given an attempt with `runId` and `conclusion: "success"` but `completedAt` null, `needsReconcile(attempt)` returns true.
3. **needsReconcile — both set:** Given an attempt with `runId`, `conclusion`, and `completedAt` set, `needsReconcile(attempt)` returns false.
4. **patchAttemptByRunId — completedAt from updated_at:** Given an attempt with no completedAt and payload `status: "completed"`, `updated_at: "2026-02-01T12:00:00Z"`, no `completed_at`; after patch, attempt has `completedAt === "2026-02-01T12:00:00Z"`.
5. **patchAttemptByRunId — never clear completedAt:** Given an attempt with `completedAt` set, patch with payload that has no completed_at/updated_at; attempt still has same completedAt after patch (or patch returns no change).
6. **patchAttemptByRunId — in_progress does not set completedAt:** Given an attempt with no completedAt, patch with `status: "in_progress"` and `updated_at` set; attempt must not gain completedAt.
7. **Lock — expired is inactive:** For lock with `expiresAt` in the past, `isLockActive(lock, now)` returns false.
8. **Lock — sync clears expired:** Given request with lock and `expiresAt` in the past, after sync the stored request has no lock (or lock cleared).
9. **buildAuditEvents — deterministic:** For a fixed request object and optional `nowIso`, two calls to `buildAuditEvents(request, nowIso)` return identical arrays (same length, same `type`/`at`/order).
10. **Reconcile fetch bypassCache:** The code path that fetches GET `/repos/.../actions/runs/{runId}` for reconcile passes `bypassCache: true` to the GitHub request helper (inspect sync route and rateAware usage).

Existing scripts that cover some of these: `npm run validate:needsReconcile-completedAt`, `npm run validate:attempt-completedAt`, `npm run validate:audit`, `npm run validate:lock`.

---

## Enforcement strategy

Invariants are protected by **unit tests** under `tests/invariants/`. Run them with:

```bash
npm run test:invariants
```

This suite **must** pass before merging lifecycle or sync changes. The tests are **storage-agnostic** (no DB, no S3); they use fixtures and mocked payloads only, so they remain valid across future persistence migrations.

---

## CI contract (future)

- CI **SHOULD** run `npm run test:invariants` (e.g. on PR or before deploy).
- Any failure is a **lifecycle regression** and must be fixed before merge.
