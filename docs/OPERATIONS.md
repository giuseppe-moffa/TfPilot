# Operations

Short playbook for recovery and common operations. No application logic changes here; docs only.

---

## Request stuck states

| Symptom | What to do |
|---------|------------|
| **Stuck “planning” or “applying”** | Webhook may have been missed. Open request → ensure sync runs (or call GET `/api/requests/:id/sync?repair=1`). Sync fetches PR and workflow runs from GitHub and patches the request. |
| **Stuck “destroying”** | If destroy was triggered but no conclusion for >15 min, status derives to `failed` and `isDestroyRunStale` is true. Use **Repair** (sync with `?repair=1`) to refresh run status. If run actually failed, user can retry destroy. |
| **List shows stale status** | List uses stored data; detail page uses derived status. Trigger a sync on the request (e.g. open detail) or wait for next list revalidation. |

---

## Repair endpoint usage

- **GET** `/api/requests/:requestId/sync?repair=1` — Forces full GitHub fetch and patch (PR, reviews, cleanup PR, plan/apply/destroy runs). Use when you suspect missing facts or stale destroy.
- **GET** `/api/requests/:requestId/sync?hydrate=1` — Same as repair for “do GitHub calls” (no semantic difference in current code).
- Requires session + GitHub token. On success returns `request` with derived `status` and `sync: { mode: "repair" }`.

---

## Re-sync guidance

- Normal sync runs automatically when `needsRepair(request)` is true (missing PR, missing run facts, or stale destroy). No query param needed.
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
