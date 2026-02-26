# Glossary

Consistent terminology for TfPilot docs and code.

---

## Workflow kinds

| Kind | Meaning |
|------|---------|
| **plan** | Terraform plan workflow (request-scoped). |
| **apply** | Terraform apply workflow (env-state serialized). |
| **destroy** | Terraform destroy workflow (env-state serialized). |
| **cleanup** | Cleanup workflow: strip TfPilot block, open cleanup PR. |
| **drift_plan** | Drift detection plan (e.g. nightly on base branch). |

Defined in **lib/github/workflowClassification.ts** (`WorkflowKind`). Used in run index and webhook classification.

---

## Canonical statuses

Display status set (see **lib/status/status-config.ts**):  
`request_created`, `planning`, `plan_ready`, `approved`, `merged`, `applying`, `applied`, `destroying`, `destroyed`, `failed`.

- **Terminal:** `applied`, `destroyed`, `failed`.
- **Active (polling/SSE):** `planning`, `applying`, `destroying`.

All derived by `deriveLifecycleStatus(request)`; not stored as source of truth (see **docs/REQUEST_LIFECYCLE.md**).

---

## Repair

- **Meaning:** Sync that performs GitHub API calls to refresh request facts (PR, reviews, workflow runs) and optionally retry cleanup dispatch after destroy success.
- **When:** Sync runs repair when `needsRepair(request)` is true, or when the client calls sync with `?repair=1` or `?hydrate=1`.
- **Endpoint:** GET `/api/requests/:requestId/sync` (with optional `repair=1` or `hydrate=1`). Implemented in **app/api/requests/[requestId]/sync/route.ts**; policy in **lib/requests/syncPolicy.ts**.
