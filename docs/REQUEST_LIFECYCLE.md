# Request lifecycle

End-to-end flow and status rules. Source of truth: **lib/requests/deriveLifecycleStatus.ts**.

---

## Lifecycle stages

| Stage | Description |
|-------|-------------|
| **Create** | POST `/api/requests`: persist to S3, create branch `request/<requestId>`, open PR, dispatch plan. |
| **Plan** | GitHub Actions run plan (`-lock=false`). Run index written; webhook/sync patch `planRun`. |
| **Approve** | User/approver approves → POST approve route → `approval.approved` + approvers. |
| **Merge** | PR merged (UI or API) → merge route sets `mergedSha`; webhook can patch `pr.merged`. |
| **Apply** | User triggers apply → dispatch apply workflow; run index written; webhook/sync patch `applyRun`. |
| **Destroy** | User triggers destroy → dispatch cleanup (fire-and-forget), dispatch destroy, set `destroyRun` + `destroyTriggeredAt`. Cleanup PR strips TfPilot block; after destroy success, request archived to `history/`. |
| **Cleanup** | Workflow runs on cleanup branch; cleanup PR state patched via sync/webhook. |

---

## Status derivation (canonical)

Status is **not** stored as authoritative (except conceptually for destroy). It is computed by `deriveLifecycleStatus(request)` from:

- `pr` or `github.pr`
- `planRun` or `github.workflows.plan`
- `applyRun` or `github.workflows.apply`
- `destroyRun` or `github.workflows.destroy`
- `approval`, `mergedSha`

**Priority order (exact from code):**

1. Destroy run failed conclusion → `failed`
2. Destroy run success → `destroyed`
3. Destroy in progress (and not stale) → `destroying`; if stale (no conclusion for >15 min after `destroyTriggeredAt`) → `failed`
4. Apply run failed → `failed`
5. Plan run failed → `failed`
6. Apply running → `applying`
7. Apply success → `applied`
8. PR merged or `mergedSha` → `merged`
9. Approval approved → `approved`
10. Plan success → `plan_ready`
11. Plan running or PR open → `planning`
12. Else → `request_created`

**Canonical status set** (see `lib/status/status-config.ts`): `request_created`, `planning`, `plan_ready`, `approved`, `merged`, `applying`, `applied`, `destroying`, `destroyed`, `failed`.

---

## Failure modes and retry/repair

| Situation | Behavior |
|-----------|----------|
| **State lock** | Apply/destroy workflows use concurrency group per env (state); plan uses per-request group. Lock contention is in GitHub, not TfPilot. |
| **Webhook loss** | Sync runs when `needsRepair(request)` (missing PR, missing run facts, or stale destroy). GET `/api/requests/:id/sync?repair=1` forces full GitHub fetch + patch. |
| **Stale destroy** | If destroy was triggered but no conclusion for >15 min, `deriveLifecycleStatus` returns `failed` and `isDestroyRunStale(request)` is true. UI can show “Repair” / “Retry destroy”. Sync repair refreshes run; optional re-dispatch destroy. |
| **Cleanup dispatch failed** | After destroy success, webhook may trigger cleanup dispatch. If that fails, sync with `?repair=1` re-attempts cleanup dispatch and updates `cleanupDispatchStatus`. |

**Repair:** Sync with `?repair=1` (or `hydrate=1`) forces GitHub calls and re-patches request facts. When `needsRepair(request)` is true, sync does the same without the query param. See **docs/OPERATIONS.md**.

---

## Stale destroy handling (code)

- `DESTROY_STALE_MINUTES = 15` in `deriveLifecycleStatus.ts`.
- `isDestroyRunStale(request)` is true when `destroyTriggeredAt` is set, run is in_progress/queued with no conclusion, and >15 min have passed.
- UI uses this to show “Repair” and treat as not actively destroying.
