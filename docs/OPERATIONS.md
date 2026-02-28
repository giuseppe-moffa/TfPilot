# Operations

Short playbook for recovery and common operations. No application logic changes here; docs only.

---

## Request stuck states

| Symptom | What to do |
|---------|------------|
| **Stuck “planning” or “applying”** | Sync fetches and patches when the current attempt satisfies **needsReconcile** (runId present, conclusion missing). Open the request so the UI polls (or call GET `/api/requests/:id/sync?repair=1`). Use repair if runId was never set. |
| **Stuck “destroying”** | Sync fetches the destroy run when the current destroy attempt satisfies needsReconcile, so UI polling converges. If no conclusion for >15 min, status derives to failed; use Repair (sync with ?repair=1) to refresh or retry cleanup. |
| **List shows stale status** | List is revalidated via global SSE (root layout): on request event, `req:${id}` mutated immediately and `/api/requests` after 300ms debounce. Trigger sync on the request or wait for next SSE-driven revalidation. |

---

## Repair endpoint usage

- **GET** `/api/requests/:requestId/sync?repair=1` — Forces full GitHub fetch and patch (PR, reviews, cleanup PR, and current run attempts by runId). Use when you suspect missing facts or stale destroy.
- **GET** `/api/requests/:requestId/sync?hydrate=1` — Same as repair for “do GitHub calls” (no semantic difference in current code).
- Requires session + GitHub token. On success returns `request` with derived `status` and `sync: { mode: "repair" }`.

---

## Re-sync guidance

- Normal sync runs when `needsRepair(request)` is true **or** when any current attempt (plan/apply/destroy) satisfies **needsReconcile** (runId present and conclusion missing). In the latter case sync fetches that run and patches the attempt, so "stuck destroying" (or planning/applying) converges without `?repair=1`. No query param needed for that. Use `?repair=1` to force full GitHub fetch (e.g. missing runId resolution, PR/cleanup refresh, stale destroy).
- To force re-sync even when repair not needed: use `?repair=1` or `?hydrate=1`.
- After approve/merge/apply/destroy, UI typically revalidates; webhooks also patch. If events were lost, use repair once.

---

## Safely resetting dev (state + requests)

**Warnings:**

- Resetting Terraform state and/or archiving requests in dev is destructive. Only do this in a dedicated dev environment.
- Ensure no one relies on existing dev resources or request history before reset.

**Suggested steps (operator-owned):**

1. **State:** In the infra repo, for the dev env, either remove or reset the state object (e.g. S3 state key / DynamoDB lock). Follow your org’s Terraform state backup/restore policy.
2. **Requests:** TfPilot does not provide a “delete all requests” API. To clear or archive dev requests you would need to use S3 directly (e.g. list/delete under `requests/` or move to `history/`) or add an admin-only endpoint. Document any such procedure in your runbook.
3. **Run index:** Optional cleanup of `webhooks/github/run-index/` in the requests bucket if you want to avoid stale runId→requestId mappings. Not required for correctness; fallbacks exist.

**Known gap:** No in-app “reset dev” button or single API. Operations are manual (state) and/or S3/admin (requests). See **docs/SYSTEM_OVERVIEW.md** for storage layout.

---

## Known gaps (docs only)

If you find behavior that contradicts these docs or intended behavior, add a short “Known gap” note here with file references. Do not refactor application logic in the docs-only pass.
