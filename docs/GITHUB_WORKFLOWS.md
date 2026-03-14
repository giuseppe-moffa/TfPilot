# GitHub workflows

Workflows live in infra repos (e.g. **core-terraform**, **payments-terraform**). TfPilot dispatches them via GitHub API.

---

## Workflow kinds

| Kind | Purpose | Concurrency | Lock |
|------|---------|-------------|------|
| **plan** | `terraform plan -lock=false`, upload plan artifact | Per workspace + request_id (`cancel-in-progress: true`) | No lock acquisition |
| **apply** | `terraform apply` after PR merged | Per workspace **state group** (serialized per workspace) | Uses state lock |
| **destroy** | Destroy resources; runs after cleanup | Per workspace **state group** (serialized per workspace) | Uses state lock |
| **cleanup** | Strip TfPilot block from workspace files, open cleanup PR | Per workspace + request_id | N/A |
| **drift_plan** | Plan on base branch to detect drift (e.g. nightly) | Per workspace (v2) | No lock |

---

## Concurrency (workspace inputs)

- **Plan / cleanup:** `group: <repo>-${{ inputs.workspace_key }}-${{ inputs.workspace_slug }}-${{ inputs.request_id }}` — one active plan per request; cancel-in-progress for plan.
- **Apply / destroy / drift:** `group: <repo>-state-${{ inputs.workspace_key }}-${{ inputs.workspace_slug }}` — **serialized per workspace** to protect state lock.

Concurrency is enforced per workspace because each workspace represents an isolated Terraform state (**Workspace Sharding**: scale by more workspaces, not bigger workspaces).

---

## Inputs contract

TfPilot sends **workspace-only** input names. Infra workflows must use these names.

| Input | Description |
|-------|-------------|
| `request_id` | TfPilot request ID (required for plan, apply, destroy, cleanup). |
| `workspace_id` | Workspace ID (for destroy full-scope; used by webhook for correlation). |
| `workspace_key` | Workspace key (e.g. `dev`, `prod`). |
| `workspace_slug` | Workspace slug (e.g. `ai-agent`). |
| `ref` / branch | Branch to run on (e.g. `request/<requestId>` for plan; default branch for destroy). |
| `dry_run` | Optional; some workflows support it. |
| `destroy_scope` | Destroy only: `module` = single request; `workspace` = full workspace destroy. |

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

Workflow files `plan.yml`, `apply.yml`, `destroy.yml`, `drift_plan.yml`, `cleanup.yml` are used by the app.

### v2 inputs (workspace-only)

| Input | Required | Description |
|-------|----------|-------------|
| `request_id` | plan: yes; apply: no; destroy: yes if scope=module | TfPilot request ID |
| `workspace_id` | destroy (full scope) | Workspace ID for webhook correlation |
| `workspace_key` | yes | Workspace key (e.g. `dev`, `prod`) |
| `workspace_slug` | yes | Workspace slug (e.g. `ai-agent`) |
| `destroy_scope` | destroy only | `module` = target single module; `workspace` = full workspace destroy (no -target) |
| `ref` | no | Git ref to checkout (default: main) |
| `dry_run` | no | Skip terraform destroy if true |

### v2 workspace root (in workflow)

- Workspace root path: `envs/${workspace_key}/${workspace_slug}/` (historical path convention; variable names in workflow should use `workspace_key` / `workspace_slug`).
- `working-directory` uses this path (e.g. `env.ENV_ROOT` or equivalent).
- All artifact paths and Infracost plan path use the workspace root.

### v2 backend init

- `bucket` = `tfpilot-tfstate-<repo>-${workspace_key}`
- `key` = `${workspace_slug}/terraform.tfstate`
- `dynamodb_table` = `tfpilot-tfstate-lock-<repo>-${workspace_key}`

### v2 concurrency

- **Plan:** `group: <repo>-${{ inputs.workspace_key }}-${{ inputs.workspace_slug }}-${{ inputs.request_id }}` — one per request.
- **Apply / destroy / drift:** `group: <repo>-state-${{ inputs.workspace_key }}-${{ inputs.workspace_slug }}` — serialized per workspace root.

### v2 artifact names

- `plan-logs-v2`, `apply-logs-v2`, `destroy-logs-v2`
- `drift-logs-v2`, `drift-plan-json-v2` — drift plan v2 artifacts (per workspace root).

### Drift plan v2

- **Workflow:** `drift_plan.yml`
- **Inputs:** `workspace_key`, `workspace_slug` (no `request_id`; workspace-scoped).
- **Concurrency:** Same as apply/destroy: `group: <repo>-state-${{ inputs.workspace_key }}-${{ inputs.workspace_slug }}`.
- **Artifacts:** `drift-logs-v2` (plan.txt, .terraform.lock.hcl), `drift-plan-json-v2` (plan.json).
- **No webhook:** Last drift is derived from GitHub runs + workspace drift index.
