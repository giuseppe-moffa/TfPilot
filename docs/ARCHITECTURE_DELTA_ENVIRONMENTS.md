# Architecture Delta: Environments (Model 2 — Multi-Environment per Env Key)

> **NOTE: Model 2 is implemented.** All examples below MUST use:
> - `envs/<environment_key>/<environment_slug>/`
> - `<module>_req_<request_id>.tf`
> - `environment_key`/`environment_slug` (no `request.environment`)

See [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md), [ENVIRONMENT_TEMPLATES_DELTA.md](ENVIRONMENT_TEMPLATES_DELTA.md).

## Status
Design delta. Fresh system. No backward compatibility required.

**Phase 3–6:** Model 2 renderer, deploy flow, environment activity, and request API with `environment_id` / `(environment_key, environment_slug)` are implemented. Terraform roots: `envs/<key>/<slug>/`; request files `<module>_req_<request_id>.tf`. No `request.environment`; no `req_<id>.tf`.

---

# 1. Goal

Introduce first-class Environment entities with support for:

envs/<environment_key>/<environment_slug>/

Examples:

envs/dev/ai-agent/
envs/dev/payments-sandbox/
envs/dev/feature-123/
envs/prod/ai-agent/

This shifts the system from:

- 1 root per env_key (envs/dev)

to:

- 1 Terraform root per (environment_key + environment_slug)

---

# 2. Non-Negotiable Invariants (Unchanged)

These MUST NOT change:

- Lifecycle status is derived from facts only.
- Attempts are created only on dispatch.
- Webhooks/sync patch attempt facts only.
- S3 request document remains authoritative.
- Postgres remains projection only.
- PR-native execution remains mandatory.
- No direct Terraform execution from app.
- No Terraform workspaces.

---

# 3. Canonical Data Model (New Standard)

## 3.1 Environment Entity (Postgres)

Table: environments

Fields:

- environment_id (PK)
- project_key
- repo_full_name
- environment_key (dev | prod)
- environment_slug
- template_id
- template_version (commit SHA)
- created_at
- updated_at
- archived_at (nullable)

Unique constraint:

(repo_full_name, environment_key, environment_slug)

### environment_slug Constraints

- Lowercase only
- Alphanumeric + hyphen
- Must start with a letter
- Max length: 63 characters
- No spaces
- No underscores

---

## 3.2 Request Model (Canonical Fields)

Use `environment_key`, `environment_slug`, `environment_id` only (no `request.environment`):

- environment_key
- environment_slug
- environment_id

Derived field:

targetEnvPath = envs/<environment_key>/<environment_slug>

- Requests MUST reference an Environment by:
  - Preferred: environment_id
  - Allowed: (environment_key, environment_slug) for create flows
- Server must resolve:
  - repo_full_name (from project config)
  - targetEnvPath = envs/${environment_key}/${environment_slug}
  - any template-derived defaults (via environment.template_id/version)

Request IDs:

- Request IDs MUST NOT depend on environment_slug.
- Generate using: environment_key + module + random suffix (or ULID).

### Important Rules

- targetEnvPath MUST be computed server-side.
- It must never be accepted directly from client input.
- Client supplies only environment_id or (environment_key + environment_slug).
- Server derives path deterministically.
- Repo resolution is based on project_key and environment_key only.
- environment_slug MUST NOT influence repo selection.
- All slugs under the same project_key + environment_key share the same repo.

There must be no use of request.environment anywhere in the system.

---

# 4. Repository Structure (New Contract)

## 4.1 Terraform Root per Environment

Each environment is its own Terraform root:

envs/<environment_key>/<environment_slug>/

Example:

envs/dev/ai-agent/

Workflows must run with:

working-directory: envs/${environment_key}/${environment_slug}

---

## 4.2 Module Source Path Rule (CRITICAL)

Because the new root depth becomes:

envs/<key>/<slug>/

All Terraform module sources MUST use:

source = "../../../modules/<module>"

The renderer must be updated accordingly.

Hardcoded "../../modules/<module>" is invalid and must not exist anywhere.

---

## 4.3 TfPilot Ownership Boundary

TfPilot ONLY writes inside:

envs/<environment_key>/<environment_slug>/tfpilot/**

Recommended structure:

envs/dev/ai-agent/
  backend.tf
  providers.tf
  versions.tf
  tfpilot/
    base.tf
    requests/
      <module>_req_<request_id>.tf

Rules:

- No splicing into shared files.
- No tfpilot.<type>.tf files.
- No begin/end markers required.
- Each request owns exactly one file:
  tfpilot/requests/<module>_req_<request_id>.tf
- Cleanup = delete file.
- Path derived from (module, request_id) in request doc; never parse filename.

Cleanup semantics:

- Cleanup MUST delete request files directly when given path derived from (module, request_id):
  - envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf
- Marker-based block removal is not required for Model 2 and should not be relied on.

---

# 5. Terraform State Strategy (LOCKED — Strategy A)

## 5.1 No Terraform Workspaces

We explicitly do NOT use Terraform workspaces.

Isolation is achieved via backend key prefix.

---

## 5.2 Backend Isolation Model

For each environment_key:

- One S3 bucket
- One DynamoDB lock table

Examples:

tfpilot-tfstate-core-dev
tfpilot-tfstate-core-prod

Within bucket:

key = <environment_slug>/terraform.tfstate

Example:

ai-agent/terraform.tfstate
feature-123/terraform.tfstate

---

## 5.3 backend.tf Contract

backend.tf must:

- Define backend "s3" {} generically.
- NOT hardcode the state key.
- NOT embed environment_slug directly.
- NOT define key = "terraform.tfstate".
- Accept bucket and key via workflow -backend-config flags.

State key injection MUST happen via workflow init step.

---

# 6. Workflow Contract (Updated)

All workflows must accept:

- environment_key
- environment_slug
- request_id

GitHub Environment protection mapping:

- GitHub workflow environment (prod/nonprod protection + secrets) MUST map from environment_key only:
  - environment_key == "prod" → production
  - otherwise → nonprod
- environment_slug MUST NOT influence GitHub environment selection.

Infracost plan path rule:

- Define canonical env root variable:
  - ENV_ROOT = envs/${environment_key}/${environment_slug}
- ENV_ROOT must be derived identically and used consistently across all workflows (plan, apply, destroy, drift-plan, infracost) for working-directory, artifact paths, and plan.json consumption.
- Infracost MUST read:
  - ${ENV_ROOT}/plan.json
- Replace any existing logic referencing envs/${ENVIRONMENT}/plan.json accordingly.

---

## 6.1 Working Directory

Replace:

envs/${environment}

With:

envs/${environment_key}/${environment_slug}

---

## 6.2 Backend Init

Must use:

-backend-config="bucket=tfpilot-tfstate-<repo>-${environment_key}"
-backend-config="key=${environment_slug}/terraform.tfstate"
-backend-config="dynamodb_table=tfpilot-tfstate-lock-<repo>-${environment_key}"

---

## 6.3 Concurrency Groups

Plan:

<repo>-terraform-${environment_key}-${environment_slug}-${request_id}

(cancel-in-progress: true)

Apply / Destroy:

<repo>-terraform-state-${environment_key}-${environment_slug}

This prevents:

- dev/ai-agent blocking dev/feature-123
- while still serializing apply/destroy per environment

---

## 6.4 Workflow Artifact Paths (IMPORTANT)

All workflow artifact paths (plan.txt, plan.json, apply.txt, destroy.txt)
must reference:

envs/${environment_key}/${environment_slug}/

Example:

envs/${environment_key}/${environment_slug}/plan.txt

Any existing references to:

envs/${ENVIRONMENT}/

must be updated.

Failure to update artifact paths will cause artifact upload or plan parsing steps to fail.

---

## 6.5 API Contract Changes (Model 2)

### New/updated Environment endpoints (contract-level)

- **POST /api/environments** — Create a new Environment; persists to Postgres and triggers bootstrap PR flow.
- **GET /api/environments** — List environments (filterable by project_key, environment_key); returns metadata + derived state.
- **GET /api/environments/:id** — Returns `deployed`, `deployPrOpen`, `deployPrUrl`, `envRootExists`, `error`. Fail-closed (e.g. ENV_DEPLOY_CHECK_FAILED) sets `deployPrOpen` and `envRootExists` to `null`.
- **POST /api/environments/:id/destroy** — Trigger full environment destroy (destroy_scope=environment), then archive.

### Request create/update contract (Model 2)

- Requests MUST target an Environment via environment_id (preferred).
- Server MAY accept (environment_key, environment_slug) only for create flows, but must resolve to a single Environment and then use environment_id internally.
- If client provides both environment_id and (environment_key, environment_slug), server MUST enforce they match, else return 400.

### Workflow dispatch inputs (Model 2)

- All dispatchers MUST send: environment_key, environment_slug, request_id.
- Destroy must additionally support destroy_scope (module vs environment) for the destroy workflow.
- The legacy single field "environment" must be removed from dispatch payloads in Model 2.

### Decisions

- **Request update route:** The existing POST `/api/requests/update` route remains unchanged in Model 2. Request update operations MUST NOT allow modifying `environment_id`, `environment_key`, or `environment_slug` after creation.
- **Drift-plan trigger:** Drift-plan remains GitHub-workflow initiated only. If an application-level drift trigger is introduced later, it MUST follow the same `environment_key` + `environment_slug` workflow input contract.

---

# 7. Environment Creation Flow (Explicit)

Users must create an Environment first.

Flow:

1. Navigate to "Create Environment"
2. Select:
   - project
   - environment_key (dev/prod)
   - environment_slug
   - environment template
3. System creates:
   - Environment DB row
   - Bootstrap PR that creates:

     envs/<environment_key>/<environment_slug>/
       backend.tf
       providers.tf
       versions.tf
       tfpilot/base.tf
       tfpilot/requests/.gitkeep

backend.tf must contain backend "s3" {} without key attribute.

Environment bootstrap PR MUST create the full directory structure before any request PR can target it.

---

# 8. Environment Destroy Semantics

Destroying an Environment must:

1. Trigger full terraform destroy for the root:
   envs/<environment_key>/<environment_slug>/
2. Wait for destroy apply to succeed.
3. Archive the environment record (set archived_at).
4. Prevent new requests from targeting archived environments.

Destroy scope rule:

- Destroy workflow MUST support two scopes:
  - destroy_scope="module" → current behavior (uses -target=module.<name>)
  - destroy_scope="environment" → full env destroy (NO -target, runs plain terraform destroy)
- Environment destroy operation MUST use destroy_scope="environment" and then archive the Environment.

---

# 9. Single Resource Request Flow (Unchanged Conceptually)

Users create requests as usual.

Differences:

- Must select existing Environment.
- Request writes file into:

  envs/<environment_key>/<environment_slug>/tfpilot/requests/<module>_req_<request_id>.tf

Everything else remains unchanged:

- PR creation
- Plan
- Approval
- Merge
- Apply
- Destroy
- Attempt model
- Lifecycle derivation

---

# 10. Environment Health (Derived Only)

Environment does NOT store authoritative status.

Environment view aggregates:

- Latest request by COALESCE(last_activity_at, updated_at)
- Derived lifecycle of latest request
- Drift flags (future)
- Cost flags (future)

Must always recompute from request facts.

---

# 11. What We Explicitly Remove

- No shared tfpilot.<type>.tf
- No block begin/end markers
- No single-root-per-dev assumption
- No "../../modules" relative path
- No backend key = terraform.tfstate without slug
- No concurrency scoped only to environment_key
- No Terraform workspaces

---

# 12. Risk Areas (Acknowledged)

Major change surfaces:

- Workflow YAML
- Backend config
- Concurrency strings
- Infra repo structure
- resolveInfraRepo logic
- targetEnvPath generation
- Renderer module path generation

Non-standard terraform repo:

- tfpilot-terraform is excluded from Model 2 (does not follow envs/<key>/<slug> root contract) and remains on its current execution path.

Lifecycle engine remains untouched.

---

# 13. Final Sanity Summary

This delta:

- Preserves all lifecycle invariants.
- Correctly updates module path depth.
- Correctly updates backend isolation.
- Changes Terraform isolation boundary safely.
- Introduces first-class Environments.
- Eliminates shared file mutation risks.
- Scales to unlimited environments per environment_key.
- Avoids infrastructure explosion.
- Requires no backward compatibility.
- Is safe for deterministic, PR-native execution.

---

# 14. Implementation Mapping Checklist (Code Surface Map)

A structured checklist mapping architectural changes to concrete code areas.

## 14.1 TfPilot Application

- Use environment_id + environment_key + environment_slug (no request.environment):
  - POST /api/requests
  - POST /api/requests/update
  - POST /api/requests/[requestId]/destroy
- Add new environment routes:
  - POST /api/environments
  - GET /api/environments
  - GET /api/environments/:id
  - POST /api/environments/:id/destroy
- Update resolveInfraRepo logic (project_key + environment_key only)
- Remove envPath static config usage
- Replace upsertRequestBlock logic with file-per-request renderer
- Update dispatch payloads to send:
  - environment_key
  - environment_slug
  - request_id
  - destroy_scope (where applicable)
- Enforce immutability of environment_id on request update

## 14.2 Terraform Repositories

- Update workflow inputs to include:
  - environment_key
  - environment_slug
- Update working-directory to ENV_ROOT
- Update -backend-config key injection
- Update artifact paths to ENV_ROOT
- Update concurrency groups to include slug
- Update destroy workflow to support destroy_scope
- Remove marker-based cleanup logic
- Ensure module source depth is ../../../modules

## 14.3 Data Layer

- Create environments table
- Add unique constraint (repo_full_name, environment_key, environment_slug)
- Ensure request records persist environment_id
- Ensure archived_at blocks new request creation

---

# 15. Lifecycle Sequence Diagrams (Logical Flow)

High-level step flows for Model 2.

## 15.1 Environment Create

1. User creates Environment (POST /api/environments)
2. Environment row persisted
3. Bootstrap PR created
4. Merge → env root exists
5. Environment becomes selectable for requests

## 15.2 Request Create

1. User submits request (environment_id)
2. Server resolves repo + ENV_ROOT
3. Renderer writes tfpilot/requests/<module>_req_<request_id>.tf
4. Plan workflow dispatched
5. Attempt created
6. Webhook patches facts
7. Lifecycle derived

## 15.3 Environment Destroy

1. User triggers environment destroy
2. Dispatch destroy workflow with destroy_scope=environment
3. Full terraform destroy (no -target)
4. On success → archive environment
5. Prevent new requests