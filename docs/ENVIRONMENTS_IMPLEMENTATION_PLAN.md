Guiding rules for the migration plan

**Note:** Migration plan for Model 2. Current state: implemented. Request files: `<module>_req_<request_id>.tf`. See [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

Tier-A lifecycle invariants are off-limits: attempts created only on dispatch; status derived from facts; webhook/sync patch attempts only; no stored truth. 

INVARIANTS

 

INVARIANTS

No partial path migration: once cutover happens, ENV_ROOT must always be envs/${environment_key}/${environment_slug} everywhere (app + workflows + terraform repo + artifacts + infracost). 

ARCHITECTURE_DELTA_ENVIRONMENTS

Bootstrap-first: an Environment must exist (and be merged) before any request can target it. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Phase 0 — “Cutover scaffolding” (safe, staged, no behavior change)

Goal: Land code and schema that are inert until we flip the execution contract.

0.1 Data layer (staged)

Add environments table + constraints (unique (repo_full_name, environment_key, environment_slug)), archived_at support, slug validation rules. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Add any minimal request-side storage you need for environment_id, environment_key, environment_slug in the request document shape (S3 doc remains authoritative; Postgres is projection only). 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_DB

Why safe: no existing Model 1 paths need to read this yet.

0.2 Domain helpers (staged)

Introduce pure functions (no wiring yet) for:

validateEnvironmentSlug(slug)

computeEnvRoot(environment_key, environment_slug) → envs/<key>/<slug>

resolveEnvironmentRef(input) (by environment_id preferred, or (key,slug) for create) enforcing match rule when both supplied. 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Why safe: doesn’t change dispatch, runs, sync, or status derivation.

Phase 1 — Environments API + bootstrap PR (staged, independent of requests)

Goal: Create Environments and their folders in infra repos without touching request creation yet.

1.1 New API endpoints (staged)

Implement:

POST /api/environments → creates DB row + opens bootstrap PR that adds:

envs/<key>/<slug>/backend.tf (generic backend "s3" {} with no key)

providers.tf, versions.tf

tfpilot/base.tf

tfpilot/requests/.gitkeep 

ARCHITECTURE_DELTA_ENVIRONMENTS

GET /api/environments / GET /api/environments/:id (derived health only; aggregate from requests; do not store status). 

ARCHITECTURE_DELTA_ENVIRONMENTS

Ordering constraint: This requires repo resolution = (project_key + environment_key) only, slug must not affect repo selection. 

ARCHITECTURE_DELTA_ENVIRONMENTS

1.2 Environment selection gating (staged)

Environments are “selectable” only once bootstrap PR is merged (you can infer via stored merge SHA or by checking repo path existence; whichever you already use for PR facts—still derived, no new truth store).

Why staged: You can ship Environments UI & bootstrap flow while requests remain Model 1.

Phase 2 — Terraform repo workflow upgrades (prepare first, but don’t rely on them yet)

Goal: Make infra repos capable of Model 2 execution without breaking Model 1 runs yet.

You have two safe approaches; pick one:

Option A (preferred): introduce new workflow files for Model 2 (no breaking risk)

Add parallel workflows (e.g. plan_v2.yml, apply_v2.yml, destroy_v2.yml) that accept:

environment_key, environment_slug, request_id (and destroy_scope for destroy) 

ARCHITECTURE_DELTA_ENVIRONMENTS

Keep old workflows intact until cutover.

Option B: update existing workflows in-place (higher risk)

Only do this if you can guarantee the app cutover deploy and infra repo PR merge happen as one coordinated release window.

Required workflow changes (whether A or B)

Define ENV_ROOT = envs/${environment_key}/${environment_slug} and use it consistently for:

working-directory

all artifact paths

plan.json path for Infracost 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Backend init must inject:

bucket = tfpilot-tfstate-<repo>-${environment_key}

key = ${environment_slug}/terraform.tfstate

dynamodb_table = tfpilot-tfstate-lock-<repo>-${environment_key} 

ARCHITECTURE_DELTA_ENVIRONMENTS

Concurrency:

plan group includes request_id + slug

apply/destroy serialized per (environment_key, environment_slug) 

ARCHITECTURE_DELTA_ENVIRONMENTS

Destroy workflow supports destroy_scope:

"module" keeps current -target behavior

"environment" runs full destroy (no -target) 

ARCHITECTURE_DELTA_ENVIRONMENTS

Why Phase 2 must precede cutover: once the app dispatches Model 2 inputs and expects artifacts under ENV_ROOT, infra workflows must already speak that contract.

Phase 3 — Renderer + file ownership model (staged behind a switch)

Goal: Implement the “one file per request” renderer and direct file deletion cleanup, but don’t let it run until workflows/repos are ready.

3.1 Renderer changes (staged)

Replace shared-file splice/marker logic with:

envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf per request 

ARCHITECTURE_DELTA_ENVIRONMENTS

Module source path must be exactly ../../../modules/<module> (depth lock). 

ARCHITECTURE_DELTA_ENVIRONMENTS

3.2 Cleanup semantics (staged)

Cleanup becomes “delete the request file directly”, no markers. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Ordering constraint: Renderer output path + cleanup path must match workflow working-directory + git operations, otherwise destroy/cleanup will mis-target. Cleanup/destroy path is derived from (module, request_id) in the request doc; never parse filename.

Phase 4 — Request API contract update (staged, but not enabled by default)

Goal: Teach the app to understand Model 2 request fields without making Model 2 the active path yet.

4.1 Request model shape

Remove any usage of request.environment and replace with:

environment_id, environment_key, environment_slug 

ARCHITECTURE_DELTA_ENVIRONMENTS

4.2 Create/update rules

Create accepts environment_id (preferred) or (environment_key, environment_slug) for create only, resolves to environment_id. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Update route unchanged but enforces immutability: cannot change environment_id/key/slug post-create. 

ARCHITECTURE_DELTA_ENVIRONMENTS

4.3 Dispatch payloads (staged)

Plan/apply/destroy dispatchers can emit the new inputs:

environment_key, environment_slug, request_id

destroy_scope where applicable 

ARCHITECTURE_DELTA_ENVIRONMENTS

Hard constraint: do not change attempt creation, patching, sync reconciliation, or status derivation logic. 

INVARIANTS

Phase 5 — Atomic cutover (this is the “no half states” step)

This is the only step that must be atomic (single coordinated release sequence). It flips the system from Model 1 execution to Model 2 execution.

What must flip together (atomic set)

Request create path now requires selecting an Environment and always computes:

ENV_ROOT = envs/<key>/<slug> server-side 

ARCHITECTURE_DELTA_ENVIRONMENTS

Renderer writes request files under ENV_ROOT/tfpilot/requests/<module>_req_<request_id>.tf (path derived from request doc module + request_id; never parse filename) 

ARCHITECTURE_DELTA_ENVIRONMENTS

Dispatcher sends environment_key + environment_slug inputs 

ARCHITECTURE_DELTA_ENVIRONMENTS

Infra repo workflows must:

run in ENV_ROOT

init backend with ${environment_slug}/terraform.tfstate

upload/read artifacts under ENV_ROOT

apply/destroy concurrency scoped to (key,slug) 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Infracost reads ${ENV_ROOT}/plan.json 

ARCHITECTURE_DELTA_ENVIRONMENTS

Safe release choreography

Merge infra repo workflow PRs first (Phase 2 done).

Merge app PR that enables Model 2 request creation (and disables/hides Model 1 create UI).

Immediately create a pilot Environment via bootstrap and run a full request lifecycle end-to-end.

Why atomic: any mismatch among these five surfaces creates the exact broken “half Model 1 / half Model 2” state you want to avoid.

Phase 6 — Environment destroy (post-cutover, but still safe)

Goal: Support full environment teardown and archival.

POST /api/environments/:id/destroy dispatches destroy workflow with destroy_scope="environment", waits for success, then sets archived_at. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Request create must reject archived environments. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Ordering constraint: destroy_scope support must already exist in workflows (Phase 2) before enabling this endpoint.

Atomic vs staged summary
Must be atomic (single cutover set)

ENV_ROOT contract flip everywhere:

request create resolution

renderer output paths

workflow inputs + working-directory

artifact paths + Infracost plan path

backend key injection

concurrency strings 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Can be staged safely

Environments table + endpoints + UI (as long as requests still run Model 1)

Renderer implementation (kept unused until cutover)

Workflow v2 additions (parallel workflows or merged but not called yet)

Request API validation + new fields (kept unused until cutover)

Environment destroy endpoint (enabled after workflows support destroy_scope)

Ordering constraints map (what depends on what)

Data layer → API: Environments endpoints require DB table first. 

ARCHITECTURE_DELTA_ENVIRONMENTS

API (bootstrap) → Terraform repo structure: bootstrap PR defines envs/<key>/<slug> roots; requests must not target before merge. 

ARCHITECTURE_DELTA_ENVIRONMENTS

Terraform workflows → App dispatch: app cannot dispatch (key,slug) until workflows accept and use them. 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Workflows ↔ Renderer: renderer module path depth and request file location must match the repo root depth + workflow working-directory. 

ARCHITECTURE_DELTA_ENVIRONMENTS

 

ARCHITECTURE_DELTA_ENVIRONMENTS

Destroy_scope (workflows) → Environment destroy API: must exist before enabling the endpoint. 

ARCHITECTURE_DELTA_ENVIRONMENTS