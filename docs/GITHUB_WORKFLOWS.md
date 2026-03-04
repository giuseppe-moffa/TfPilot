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
| **drift_plan** | Plan on base branch to detect drift (e.g. nightly) | Per env (v2) | No lock |

---

## Concurrency (current)

- **Plan / cleanup:** `group: <repo>-${{ inputs.environment_key }}-${{ inputs.environment_slug }}-${{ inputs.request_id }}` — one active plan per request; cancel-in-progress for plan.
- **Apply / destroy / drift:** `group: <repo>-state-${{ inputs.environment_key }}-${{ inputs.environment_slug }}` — **serialized per env** to protect state lock.

---

## Inputs contract

Common inputs (names may vary by repo):

| Input | Description |
|-------|-------------|
| `request_id` | TfPilot request ID (required for plan, apply, destroy, cleanup). |
| `environment_key` / `environment_slug` | v2: `environment_key` (dev|prod), `environment_slug` (e.g. ai-agent). |
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

- On dispatch, TfPilot appends the new attempt to `request.runs.<kind>` via `persistDispatchAttempt` in **lib/requests/runsModel.ts** (status `queued`, dispatchedAt, headSha/ref/actor; runId/url optional and filled when available). When runId is known, `putRunIndex` is called (see **docs/RUN_INDEX.md**). Plan/apply/destroy routes (and drift_plan when runId is available) use this; for plan, the attempt is always created at dispatch even if runId is not yet known.

---

## Model 2 workflows (v2)

Workflow files `plan_v2.yml`, `apply_v2.yml`, `destroy_v2.yml`, `drift_plan_v2.yml`, `cleanup_v2.yml` are used by the app.

### v2 inputs

| Input | Required | Description |
|-------|----------|-------------|
| `request_id` | plan: yes; apply: no; destroy: yes if scope=module | TfPilot request ID |
| `environment_key` | yes | `dev` or `prod` |
| `environment_slug` | yes | Slug (e.g. `ai-agent`) |
| `destroy_scope` | destroy only | `module` = target single module; `environment` = full destroy (no -target) |
| `ref` | no | Git ref to checkout (default: main) |
| `dry_run` | no | Skip terraform destroy if true |

### v2 ENV_ROOT

- `ENV_ROOT = envs/${environment_key}/${environment_slug}`
- `working-directory` uses `${{ env.ENV_ROOT }}`
- All artifact paths and Infracost plan path use `${ENV_ROOT}/...`

### v2 backend init

- `bucket` = `tfpilot-tfstate-<repo>-${environment_key}` (e.g. core, payments)
- `key` = `${environment_slug}/terraform.tfstate`
- `dynamodb_table` = `tfpilot-tfstate-lock-<repo>-${environment_key}`

### v2 concurrency

- **Plan:** `group: <repo>-${{ inputs.environment_key }}-${{ inputs.environment_slug }}-${{ inputs.request_id }}` — one per request.
- **Apply / destroy:** `group: <repo>-state-${{ inputs.environment_key }}-${{ inputs.environment_slug }}` — serialized per env root.

### v2 artifact names

- `plan-logs-v2`, `apply-logs-v2`, `destroy-logs-v2`
- `drift-logs-v2`, `drift-plan-json-v2` — drift plan v2 artifacts (per ENV_ROOT).

### Drift plan v2

- **Workflow:** `drift_plan_v2.yml`
- **Inputs:** `environment_key`, `environment_slug` (no `request_id`; env-scoped).
- **Concurrency:** Same as apply/destroy: `group: <repo>-state-${{ inputs.environment_key }}-${{ inputs.environment_slug }}`.
- **Artifacts:** `drift-logs-v2` (plan.txt, .terraform.lock.hcl), `drift-plan-json-v2` (plan.json).
- **No webhook:** Last drift is derived from GitHub runs + env drift index.
