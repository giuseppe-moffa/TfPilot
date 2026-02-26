# GitHub workflows

Workflows live in infra repos (e.g. **core-terraform**, **payments-terraform**). TfPilot dispatches them via GitHub API.

---

## Workflow kinds

| Kind | Purpose | Concurrency | Lock |
|------|---------|-------------|------|
| **plan** | `terraform plan -lock=false`, upload plan artifact | Per env + request_id (`cancel-in-progress: true`) | No lock acquisition |
| **apply** | `terraform apply` after PR merged | Per env **state group** (serialized per env) | Uses state lock |
| **destroy** | Destroy resources; runs after cleanup | Per env **state group** (serialized per env) | Uses state lock |
| **cleanup** | Strip TfPilot block from env files, open cleanup PR | Per env + request_id | N/A |
| **drift_plan** | Plan on base branch to detect drift (e.g. nightly) | Typically no group or per-request | No lock |

---

## Concurrency (current)

- **Plan / cleanup:** `group: <repo>-${{ inputs.environment }}-${{ inputs.request_id }}` — one active plan per request; cancel-in-progress for plan.
- **Apply / destroy:** `group: <repo>-state-${{ inputs.environment }}` — **serialized per environment** to protect state lock. Example: `payments-terraform-state-dev`, `payments-terraform-state-prod`.

---

## Inputs contract

Common inputs (names may vary by repo):

| Input | Description |
|-------|-------------|
| `request_id` | TfPilot request ID (required for plan, apply, destroy, cleanup). |
| `environment` | `dev` or `prod`. |
| `ref` / branch | Branch to run on (e.g. `request/<requestId>` for plan; default branch for destroy). |
| `dry_run` | Optional; some workflows support it. |

TfPilot passes these on dispatch. Run index is written for plan, apply, destroy (and drift_plan when runId is available) so webhooks can correlate by runId.

---

## Artifacts and expectations

- **Plan:** Plan output (e.g. `plan.txt`, `plan.json`) uploaded as artifact; workflow reports run status/conclusion. Infracost may run and upload to S3 `cost/<requestId>/`.
- **Apply / destroy:** Logs and conclusion reported via workflow_run; run index key allows webhook to patch the correct request.
- **Cleanup:** No runId from dispatch API; correlation by branch/PR (e.g. `cleanup/<requestId>`).

---

## Run index and dispatch

- On dispatch, TfPilot persists `github.workflows.<kind>` (runId, status, url) and `destroyTriggeredAt` for destroy, and writes the run index (see **docs/RUN_INDEX.md**). Implemented in `lib/requests/persistWorkflowDispatch.ts` and used by plan/apply/destroy (and drift_plan when runId is available) routes.
