# Implementation Plan: Environment Templates + Deploy Environment (Model 2)

Status: **Phases 0–6 complete** (2026-03)  
Source: `docs/ENVIRONMENT_TEMPLATES_DELTA.md` (authoritative spec). Phases 0–6 implemented; Phase 7+ as documented.

---

## Hard Constraints

- PR-native execution preserved (no auto-merge, no bypass approval)
- Lifecycle invariants untouched
- No half-migration states
- Deploy is atomic (per delta)
- Request file naming: `tfpilot/requests/<module>_req_<request_id>.tf`
- Deployed detection: `*_req_*.tf`; ignore `.gitkeep`
- Branch conflict + GitHub failure error semantics per delta

**Phase count:** 8 phases total (Phase 0–7). Phase 0 added to ensure infra workflows can run deploy PRs before the deploy API creates them.

---

## 1) Phase List (Ordered)

### Phase 0: Infra Repo Workflow Compatibility for Deploy PRs (NEW)

**Objective:** Ensure Terraform repos can successfully plan/apply/destroy/drift/cleanup a `deploy/<key>/<slug>` PR at ENV_ROOT (not request-scoped), including artifacts, Infracost, and backend config.

**Why it must be first:** The deploy API can create PRs, but if workflows cannot run on those branches/inputs, deploy is "write-only" and implementation will stall at deploy time.

**Entry criteria:** Terraform infra repos exist; current plan/apply workflows work for single-request branches.

**Exit criteria:** All infra workflows that reference env paths, artifacts, or backend key support deploy branches at ENV_ROOT.

**Deliverables (infra repos):**
- **Workflow triggers:** Must trigger on `deploy/**` and `request/**` (e.g. `branches: [deploy/**]` or include both). Otherwise deploy PRs open but no plan workflow runs — silent failure.
- **Workflows** (plan.yml, apply.yml, destroy.yml, drift-plan.yml, cleanup.yml): accept `environment_key` + `environment_slug` (or ENV_ROOT) for deploy branches; `working-directory`, artifact paths, backend key, concurrency updated for ENV_ROOT; Infracost reads `${ENV_ROOT}/plan.json`; destroy supports `destroy_scope=environment` (or defer); **cleanup.yml**: file deletion (delete file path if exists; no marker block removal) for Model 2 paths.
- **backend.tf** (envs/dev/backend.tf, envs/prod/backend.tf): remove hardcoded `key = "terraform.tfstate"`; keep only `backend "s3" {}`; rely on `-backend-config key=...` injection from workflows. Otherwise init can behave inconsistently.

**Risks + mitigations:**
- Breaking existing request flows → use compat mode: keep current request flows working while adding deploy support.

---

### Phase 1: Request File Naming Migration

**Objective:** Migrate renderer and all request file operations to canonical format `<module>_req_<request_id>.tf` per §6.1.

**Entry criteria:** Phase 0 complete; Model 2 renderer exists; request file naming to migrate to `<module>_req_<request_id>.tf`.

**Exit criteria:** All create, destroy, cleanup paths use `<module>_req_<request_id>.tf`; invariants pass.

**Hard requirements:**
- **Destroy + cleanup must compute filename from request doc `(module, request_id)`** — never parse filenames.
- **Cleanup workflow must support file deletion** (not marker block removal) for Model 2 paths.

**Risks + mitigations:**
- Existing requests on disk use old format → document as one-time migration; new requests use new format; destroy/cleanup must support both during transition or require manual migration
- Webhook/destroy may receive old paths → ensure destroy looks up request doc for module, computes path from `(module, request_id)`

---

### Phase 2: Environment Templates Config + API

**Objective:** Add v1 environment templates via `config/environment-templates.ts` and `GET /api/environment-templates`.

**Entry criteria:** Phase 1 complete.

**Exit criteria:** Config exports baseline templates; API returns enabled templates; UI can consume.

**Risks + mitigations:**
- Config structure drift → align exactly with delta §5 (blank, baseline-ai-service, baseline-app-service, baseline-worker-service)
- Templates overlap with request templates → keep separate; catalogue unchanged (§12)

---

### Phase 3: POST /api/environments Template Validation

**Objective:** Add `INVALID_ENV_TEMPLATE` validation to `POST /api/environments` when `template_id` is invalid. Also persist `template_version` and ensure `archived_at` default null for reproducibility and template drift safety.

**Entry criteria:** Phase 2 complete.

**Exit criteria:** Invalid `template_id` returns 400 with `INVALID_ENV_TEMPLATE`; valid IDs from `GET /api/environment-templates`; endpoint persists `template_version` (commit SHA or config version marker); `archived_at` default null.

**Risks + mitigations:**
- Blank vs null semantics → treat blank as valid; only unrecognized IDs as invalid

---

### Phase 4: Module Registry (Baseline Modules)

**Objective:** Add `cloudwatch-log-group` and `iam-role` to module registry if missing, per delta §5 module availability.

**Entry criteria:** Phase 2 complete.

**Exit criteria:** Both modules present in registry with minimal fields; baselines can reference them. **Confirm Terraform modules exist in infra repos, or explicitly mark as "not deployable yet" and exclude from baseline templates until they exist.** Otherwise deploy will create invalid roots and fail in plan with confusing errors.

**Risks + mitigations:**
- Terraform modules not yet in infra repo → mark "requires module implementation"; baselines omit until Terraform exists; do not include in baseline templates until deployable
- Schema divergence → use minimal fields; expand in follow-up

---

### Phase 5: Skeleton Helper + Deploy API

**Objective:** Add `lib/terraform/envSkeleton.ts` and `POST /api/environments/:id/deploy` with full validation, GitHub checks, atomic PR creation.

**Entry criteria:** Phases 0–4 complete. (Phase 0 is what makes deploy PRs viable.)

**Exit criteria:** Deploy validates per §8; creates N request docs + skeleton; opens PR on `deploy/<key>/<slug>`; atomic on failure.

**Atomic deploy contract (tightened):**
- **Deployed detection checked before any writes.** If isDeployed GitHub check fails → 503 `ENV_DEPLOY_CHECK_FAILED` (fail closed; do not proceed).
- If PR creation fails → rollback in this order: (1) delete all created request docs, (2) delete deploy branch if created. Order matters: if branch deletion fails but docs already deleted → safe; if docs deleted second → possible orphan branch referencing files.

**Risks + mitigations:**
- GitHub rate limits → fail closed 503 per §7.1
- Branch/PR collision → return 409 with correct error code per §7.1
- Plan workflow: Phase 0 ensures deploy PRs run at ENV_ROOT.

---

### Phase 6: Deployed Detection + UI Gating

**Objective:** Implement deployed detection (`*_req_*.tf` in repo) and block "New Request" until env deployed.

**Entry criteria:** Phase 5 complete.

**Exit criteria:** Detection helper used in two places: (1) deploy route (to block re-deploy), (2) UI gating (to block "New Request"). New Request blocked when env deployed.

**Fail-closed behaviour:** If GitHub check fails:
- **Deploy route:** return 503 `ENV_DEPLOY_CHECK_FAILED` (do not proceed). Enforce in Phase 5.2 validation and 5.3 orchestration.
- **UI gating:** treat as "not deployed" + show "Cannot verify deploy status" message (prevents accidental bypass).

**Risks + mitigations:**
- GitHub API for file listing → use Contents API or tree; cache briefly; fail closed if unreachable

---

### Phase 7: Negative-Path Tests

**Objective:** Add invariant/integration tests for all deploy error codes.

**Entry criteria:** Phase 5 complete.

**Exit criteria:** Tests for INVALID_ENV_TEMPLATE, ENV_DEPLOY_IN_PROGRESS (branch exists or PR open), ENV_DEPLOY_CHECK_FAILED, ENV_ALREADY_DEPLOYED. **Add test for atomic rollback:** when PR creation fails, assert request docs are deleted and deploy branch is removed. Optionally add error code `ENV_DEPLOY_PR_CREATE_FAILED` to validate rollback behaviour.

**Risks + mitigations:**
- GitHub mocking complexity → use unit tests with mocked GitHub client where possible

---

## 2) Chunk List Per Phase

### Phase 0: Infra Repo Workflow Compatibility for Deploy PRs

#### Chunk 0.1: All workflows ENV_ROOT support (plan, apply, destroy, drift-plan, cleanup)

| Field | Value |
|-------|-------|
| **Chunk name** | All workflows ENV_ROOT support |
| **Why now** | Deploy API creates PRs; all workflows that reference env paths/artifacts/backend keys must run on them |
| **Files likely touched** | Infra repo: `plan.yml`, `apply.yml`, `destroy.yml`, `drift-plan.yml`, `cleanup.yml` |
| **Tests to add/update** | Workflow YAML validation; manual run on deploy branch |
| **Manual verification** | 1. Workflows trigger on deploy/** and request/** 2. Create deploy branch manually; plan workflow runs 3. Verify working-directory = envs/<key>/<slug>/ 4. plan.json artifact path, drift-plan reads it 5. Infracost reads ${ENV_ROOT}/plan.json 6. destroy.yml ENV_ROOT + backend key 7. cleanup.yml: file deletion (delete path if exists; no marker block removal) |
| **Roll-forward only** | Yes |

#### Chunk 0.2: backend.tf + concurrency for ENV_ROOT

| Field | Value |
|-------|-------|
| **Chunk name** | backend.tf + concurrency for ENV_ROOT |
| **Why now** | Workflows inject backend key; backend.tf must not hardcode it |
| **Files likely touched** | Infra repo: `envs/dev/backend.tf`, `envs/prod/backend.tf`; workflow files |
| **Tests to add/update** | Manual |
| **Manual verification** | 1. backend.tf: remove `key = "terraform.tfstate"`; keep `backend "s3" {}` only; rely on -backend-config injection 2. Concurrency groups use env key 3. Backend key includes env path in workflow |
| **Roll-forward only** | Yes |

---

### Phase 1: Request File Naming Migration

#### Chunk 1.1: Path utilities migration

| Field | Value |
|-------|-------|
| **Chunk name** | Path utilities migration |
| **Why now** | Foundation; all renderer/cleanup/destroy depend on path format |
| **Files likely touched** | `lib/renderer/model2/paths.ts`, `lib/renderer/model2/cleanup_v2.ts` |
| **Tests to add/update** | `tests/invariants/rendererModel2.test.ts` — update path assertions to `<module>_req_<request_id>.tf` |
| **Manual verification** | 1. Run `npm test -- rendererModel2` 2. Inspect `computeRequestTfPath` output for `ecr-repo_req_abc.tf` 3. Verify `assertCleanupPathSafe` accepts new pattern 4. Verify `getCleanupPathV2` accepts module param |
| **Roll-forward only** | Yes |

#### Chunk 1.2: Renderer + request create integration

| Field | Value |
|-------|-------|
| **Chunk name** | Renderer + request create integration |
| **Why now** | Request create must emit new path format |
| **Files likely touched** | `lib/renderer/model2/renderer_v2.ts`, `app/api/requests/route.ts`, `lib/requests/*` (destroy/cleanup); infra repo: `cleanup.yml` |
| **Tests to add/update** | `tests/invariants/rendererModel2.test.ts`; request create e2e if exists |
| **Manual verification** | 1. Create request via API; verify file path in PR 2. Destroy flow: verify cleanup path uses `(module, requestId)` from request doc — never parse filenames 3. Infra repo cleanup.yml: delete file path if exists; no marker block removal (Phase 0 may cover this; verify) 4. Run full invariants suite |
| **Roll-forward only** | Yes |

---

### Phase 2: Environment Templates Config + API

#### Chunk 2.1: Config scaffolding

| Field | Value |
|-------|-------|
| **Chunk name** | Config scaffolding |
| **Why now** | API depends on config |
| **Files likely touched** | `config/environment-templates.ts` (new) |
| **Tests to add/update** | Unit test for template structure and module lists |
| **Manual verification** | 1. Import config; assert blank, baseline-ai-service, etc. 2. Assert module order per delta §5 |
| **Roll-forward only** | Yes |

#### Chunk 2.2: GET /api/environment-templates

| Field | Value |
|-------|-------|
| **Chunk name** | GET /api/environment-templates |
| **Why now** | UI and validation need this |
| **Files likely touched** | `app/api/environment-templates/route.ts` (new) |
| **Tests to add/update** | API test: auth, returns list |
| **Manual verification** | 1. curl GET with session 2. Verify response shape 3. Verify only enabled templates |
| **Roll-forward only** | Yes |

---

### Phase 3: POST /api/environments Template Validation

#### Chunk 3.1: INVALID_ENV_TEMPLATE validation + template_version persistence

| Field | Value |
|-------|-------|
| **Chunk name** | INVALID_ENV_TEMPLATE validation + template_version persistence |
| **Why now** | Deploy will reuse; establish contract early |
| **Files likely touched** | `app/api/environments/route.ts`, `lib/environments/validateTemplateId.ts` (optional helper) |
| **Tests to add/update** | `tests/invariants/requestEnvironment.test.ts` or new `environmentsCreate.test.ts` |
| **Manual verification** | 1. POST with invalid template_id → 400, INVALID_ENV_TEMPLATE 2. POST with blank or valid → 201 3. Persist template_version (commit SHA or config version) 4. archived_at default null |
| **Roll-forward only** | Yes |

---

### Phase 4: Module Registry (Baseline Modules)

#### Chunk 4.1: cloudwatch-log-group + iam-role stubs

| Field | Value |
|-------|-------|
| **Chunk name** | cloudwatch-log-group + iam-role stubs |
| **Why now** | Deploy generates request files for these; registry must know schema |
| **Files likely touched** | `config/module-registry.ts`, `../terraform-modules/` (if creating Terraform) |
| **Tests to add/update** | Registry tests if present |
| **Manual verification** | 1. Module catalog includes new modules 2. Confirm Terraform modules exist in infra repos 3. If not: mark "not deployable yet", exclude from baseline templates until they exist |
| **Roll-forward only** | Yes |

---

### Phase 5: Skeleton Helper + Deploy API

#### Chunk 5.1: envSkeleton helper

| Field | Value |
|-------|-------|
| **Chunk name** | envSkeleton helper |
| **Why now** | Deploy API calls it; must be reusable, testable |
| **Files likely touched** | `lib/terraform/envSkeleton.ts` (new) |
| **Tests to add/update** | Unit tests for skeleton content (backend.tf, providers.tf, versions.tf, base.tf, .gitkeep) |
| **Manual verification** | 1. Call helper with env_key, slug; assert file map 2. No API route logic in helper |
| **Roll-forward only** | Yes |

#### Chunk 5.2: Deploy validation + GitHub checks

| Field | Value |
|-------|-------|
| **Chunk name** | Deploy validation + GitHub checks |
| **Why now** | Core deploy logic |
| **Files likely touched** | `lib/deploy/validateDeploy.ts` (new), `lib/github/*` (branch/PR lookup) |
| **Tests to add/update** | Unit tests with mocked GitHub |
| **Manual verification** | 1. Mock branch exists OR open PR → 409 ENV_DEPLOY_IN_PROGRESS 2. Mock GitHub error (branch/PR/isDeployed) → 503 ENV_DEPLOY_CHECK_FAILED, do not proceed |
| **Roll-forward only** | Yes |

#### Chunk 5.3: Deploy API route (create requests + PR)

| Field | Value |
|-------|-------|
| **Chunk name** | Deploy API route |
| **Why now** | Orchestrates validation, request creation, skeleton, PR |
| **Files likely touched** | `app/api/environments/[id]/deploy/route.ts` (new), `lib/deploy/createDeployPr.ts` |
| **Tests to add/update** | Integration test with mocked S3, GitHub |
| **Manual verification** | 1. Full deploy flow: create env, deploy, verify PR 2. Atomic rollback: PR failure → (1) delete request docs, (2) delete deploy branch; verify order 3. Deployed detection run before any writes 4. Plan workflow receives ENV_ROOT inputs (Phase 0) |
| **Roll-forward only** | Yes |

---

### Phase 6: Deployed Detection + UI Gating

#### Chunk 6.1: Deployed detection helper

| Field | Value |
|-------|-------|
| **Chunk name** | Deployed detection helper |
| **Why now** | Deploy validation and UI need it |
| **Files likely touched** | `lib/environments/isDeployed.ts` (new) |
| **Tests to add/update** | Unit tests: `*_req_*.tf` matches; `.gitkeep` does not |
| **Manual verification** | 1. Mock repo contents; assert deployed vs not 2. Case sensitivity |
| **Roll-forward only** | Yes |

#### Chunk 6.2: UI gating (block New Request until deployed)

| Field | Value |
|-------|-------|
| **Chunk name** | UI gating |
| **Why now** | Delta §3.2 gating |
| **Files likely touched** | Environment detail page, create-request flow, `GET /api/environments/:id` (isDeployed in response?) |
| **Tests to add/update** | UI/e2e or API contract test |
| **Manual verification** | 1. Env not deployed → New Request disabled or blocked 2. Env deployed → New Request enabled 3. GitHub check fails → show "Cannot verify deploy status", treat as not deployed |
| **Roll-forward only** | Yes |

---

### Phase 7: Negative-Path Tests

#### Chunk 7.1: Deploy error code tests

| Field | Value |
|-------|-------|
| **Chunk name** | Deploy error code tests |
| **Why now** | Finalize contract |
| **Files likely touched** | `tests/invariants/deployErrors.test.ts` (new) or extend existing |
| **Tests to add/update** | INVALID_ENV_TEMPLATE, ENV_ALREADY_DEPLOYED, ENV_DEPLOY_IN_PROGRESS (branch exists or PR open), ENV_DEPLOY_CHECK_FAILED; atomic rollback when PR creation fails (request docs deleted, branch removed); optionally ENV_DEPLOY_PR_CREATE_FAILED |
| **Manual verification** | 1. Run test suite 2. Each error code covered |
| **Roll-forward only** | Yes |

---

## 3) One Prompt Per Chunk

### Chunk 0.1 Prompt

```
CURSOR AGENT — Infra Repo: All Workflows ENV_ROOT Support for Deploy Branches

Goal
Ensure all Terraform infra repo workflows that reference env paths, artifacts, or backend keys can run on a deploy/<key>/<slug> PR at ENV_ROOT (not request-scoped).

Scope
- .github/workflows/plan.yml
- .github/workflows/apply.yml
- .github/workflows/destroy.yml
- .github/workflows/drift-plan.yml
- .github/workflows/cleanup.yml

Changes
- Triggers: workflows must run on deploy/** and request/** (e.g. branches: [deploy/**] or include both). Silent failure if deploy PRs open but plan never runs.
- Accept environment_key + environment_slug (or ENV_ROOT) when branch is deploy/<key>/<slug>
- working-directory = envs/<environment_key>/<environment_slug>/
- Artifact paths, backend key updated for ENV_ROOT
- Infracost job reads ${ENV_ROOT}/plan.json
- drift-plan.yml: reads plan.json, uses artifact paths for ENV_ROOT
- destroy.yml: ENV_ROOT + backend key; destroy_scope=environment if needed (or defer)
- cleanup.yml: file deletion for Model 2 — delete file path if exists; do NOT look for marker blocks

Constraints
- Compat mode: keep current request flows working; add deploy support alongside
- Do NOT break existing request/<requestId> branch behaviour

Deliverables
- All five workflow files updated
- Manual: create deploy branch, trigger plan, verify env root targeting; verify drift-plan, destroy, cleanup paths

Do NOT change TfPilot app code.
```

---

### Chunk 0.2 Prompt

```
CURSOR AGENT — Infra Repo: backend.tf + Concurrency for ENV_ROOT

Goal
Remove hardcoded backend key from backend.tf; update concurrency so deploy PRs run correctly at ENV_ROOT.

Scope
- envs/dev/backend.tf, envs/prod/backend.tf (or equivalent)
- Infra repo workflow files (concurrency)

Changes
- backend.tf: remove key = "terraform.tfstate"; keep only backend "s3" {}; rely on -backend-config key=... injection from workflows (otherwise init can behave inconsistently)
- Concurrency groups use env key (avoid parallel plan/apply on same env)
- Backend key includes env path in workflow step

Constraints
- Compat with request-scoped flows

Deliverables
- backend.tf updated
- Workflow concurrency updated
- Manual: verify backend init with injected key; verify concurrency isolation

Do NOT change TfPilot app code.
```

---

### Chunk 1.1 Prompt

```
CURSOR AGENT — Migrate Request Path Utilities to <module>_req_<request_id>.tf

Goal
Update lib/renderer/model2 to use the canonical request file naming from docs/ENVIRONMENT_TEMPLATES_DELTA.md §6.1.

Format: tfpilot/requests/<module>_req_<request_id>.tf
Example: envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_a12bc3.tf

Scope
- lib/renderer/model2/paths.ts: change computeRequestTfPath(env_key, env_slug, requestId) to computeRequestTfPath(env_key, env_slug, module, requestId). Output <module>_req_<request_id>.tf.
- lib/renderer/model2/cleanup_v2.ts: update SAFE_CLEANUP_PATTERN to accept *_req_*.tf; update assertCleanupPathSafe error message; update getCleanupPathV2 to accept module param and pass to computeRequestTfPath.
- tests/invariants/rendererModel2.test.ts: update all path assertions to new format.

Constraints
- Module must be slug-safe [a-z0-9-].
- Do NOT change app/api/requests or destroy flow in this chunk.
- Preserve MODULE_SOURCE_PREFIX and getModuleSourceV2.

Deliverables
- Summary of changes
- Files changed: paths.ts, cleanup_v2.ts, rendererModel2.test.ts
- All rendererModel2 tests pass
- Manual: assert computeRequestTfPath("dev","ai-agent","ecr-repo","a12bc3") === "envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_a12bc3.tf"

Do NOT change unrelated code.
```

---

### Chunk 1.2 Prompt

```
CURSOR AGENT — Integrate New Path Format into Renderer and Request Flows

Goal
Wire the new <module>_req_<request_id>.tf path format into the renderer, request create, and destroy/cleanup flows.

Scope
- lib/renderer/model2/renderer_v2.ts: generateModel2RequestFile must pass module to computeRequestTfPath.
- app/api/requests/route.ts: ensure generateModel2TerraformFiles uses new path (via generateModel2RequestFile which takes request.module).
- Destroy/cleanup: ensure getCleanupPathV2 receives module from request doc; compute path as <module>_req_<request_id>.tf. Never parse filenames.
- Infra repo: cleanup.yml — support file deletion (delete file path if exists; do NOT look for marker blocks). Target infra repo .github/workflows/cleanup.yml and any cleanup script it calls.
- All callers of computeRequestTfPath, getCleanupPathV2, assertCleanupPathSafe updated.

Constraints
- Request doc has module; use it. Request ID from doc.
- Destroy must compute path from (module, request_id), never from filename.
- Do NOT change plan/apply workflow inputs (ENV_ROOT scope per delta).

Deliverables
- Summary of changes
- Files changed: renderer_v2.ts, api/requests, destroy/cleanup call sites
- Invariants pass
- Manual: create request, verify PR file path; destroy, verify correct path deleted

Do NOT change unrelated code.
```

---

### Chunk 2.1 Prompt

```
CURSOR AGENT — Add config/environment-templates.ts

Goal
Create v1 environment templates config per docs/ENVIRONMENT_TEMPLATES_DELTA.md §5 and §11.1.

Scope
- config/environment-templates.ts (new)
- tests/unit/environmentTemplates.test.ts (new)

Structure
Define a type:

type EnvironmentTemplate = {
  id: string
  label?: string
  modules: {
    module: string
    order: number
    defaultConfig?: Record<string, unknown>
  }[]
}

Templates

blank  
modules: []

baseline-ai-service  
modules:
1 ecr-repo  
2 cloudwatch-log-group  
3 iam-role  
4 s3-bucket

baseline-app-service  
modules:
1 cloudwatch-log-group  
2 iam-role  
3 s3-bucket

baseline-worker-service  
modules:
1 cloudwatch-log-group  
2 iam-role  
3 s3-bucket

Export

export const environmentTemplates: EnvironmentTemplate[]

Constraints
- Static config only (no S3 / DB)
- module ids MUST match module registry keys
- modules MUST be sorted by order ascending
- Do NOT add to request template catalogue
- Do NOT import request templates

Deliverables
- config/environment-templates.ts
- Unit test asserting template count and module ordering
- Manual: import and console.log(environmentTemplates)

Do NOT change unrelated code.
```

---

### Chunk 2.2 Prompt

```
CURSOR AGENT — Add GET /api/environment-templates

Goal
Expose environment templates via API per docs/ENVIRONMENT_TEMPLATES_DELTA.md §11.2.

Scope
- app/api/environment-templates/route.ts (new)
- tests/api/environmentTemplatesRoute.test.ts (new)

Behaviour
GET returns the array exported from config/environment-templates.

Response shape
environmentTemplates[]

Auth
- Require authenticated session
- Use same auth pattern as GET /api/request-templates

Constraints
- Endpoint is separate from GET /api/request-templates
- Do NOT register templates in request template catalogue
- No database access
- No S3 calls
- Fail closed if config import fails

Deliverables
- app/api/environment-templates/route.ts
- Test: unauthenticated request returns 401
- Test: authenticated request returns template list
- Manual: curl endpoint and verify JSON array

Do NOT change unrelated code.
```

---

### Chunk 3.1 Prompt

```
CURSOR AGENT — Add INVALID_ENV_TEMPLATE + template_version persistence to POST /api/environments

Goal
Implement template_id validation in POST /api/environments per docs/ENVIRONMENT_TEMPLATES_DELTA.md §8.
Persist template_version and ensure archived_at defaults to null.

Validation rules
- template_id is optional.
- If template_id is omitted or null → allow (treat as no template; template_id=null).
- If template_id is provided → it MUST be one of:
  - "blank"
  - "baseline-ai-service"
  - "baseline-app-service"
  - "baseline-worker-service"
  Otherwise return 400 with JSON: { error: "INVALID_ENV_TEMPLATE" }.
- Empty string template_id ("") MUST be treated as invalid (400 INVALID_ENV_TEMPLATE).

template_version rule
- Persist template_version as a deterministic version marker derived server-side.
- For now set template_version = "v1" (or use an existing build SHA if there is already a single canonical source in the repo; do NOT invent a new mechanism).
- Do not accept template_version from client input.

Persistence rules
- archived_at MUST be null on create.
- template_id and template_version MUST be stored on the Environment row.

Scope
- app/api/environments/route.ts
- Optional helper: lib/environments/validateTemplateId.ts (pure function)

Deliverables
- Validation logic + helper (if used)
- 400 invalid template_id with { error: "INVALID_ENV_TEMPLATE" }
- Create persists template_id, template_version, archived_at=null
- Tests:
  - invalid template_id → 400
  - empty string template_id → 400
  - valid template_id ("blank") → 201
  - omitted template_id → 201

Constraints
- Do NOT change unrelated code.
- No deploy PR logic in this chunk.

Do NOT change unrelated code.
```

---

### Chunk 4.1 Prompt

```
CURSOR AGENT — Add cloudwatch-log-group and iam-role to Module Registry

Goal
Add baseline modules to the module registry per docs/ENVIRONMENT_TEMPLATES_DELTA.md §5.

Scope
- config/module-registry.ts

Implementation rules
- Add registry entries for:
  - cloudwatch-log-group
  - iam-role

- Entries MUST follow the exact schema used by existing modules (e.g. s3-bucket, ecr-repo).
- Do NOT invent new registry fields.

Deployability
- These modules MAY NOT exist yet in Terraform infra repos.
- If the registry supports deployability flags, mark them as:
  deployable: false

Important
- Environment templates MUST NOT be modified.
- Baseline templates must still reference these modules.
- Deploy validation later will determine if modules are deployable.

Constraints
- Do NOT create Terraform modules in infra repos.
- Do NOT change request lifecycle code.
- Do NOT modify environment templates.
- Only modify module registry.

Deliverables
- module-registry.ts updated with two new module keys
- Tests updated if registry tests exist
- Manual verification: GET /api/modules/catalog (or equivalent) lists:
  - cloudwatch-log-group
  - iam-role

Do NOT change unrelated code.
```

---

### Chunk 5.1 Prompt

```
CURSOR AGENT — Add lib/terraform/envSkeleton.ts

Goal
Create skeleton generator per docs/ENVIRONMENT_TEMPLATES_DELTA.md §4 and §15. Must NOT live in API route.

Scope
- lib/terraform/envSkeleton.ts (new)

Output files (if missing):
- envs/<key>/<slug>/backend.tf
- envs/<key>/<slug>/providers.tf
- envs/<key>/<slug>/versions.tf
- envs/<key>/<slug>/tfpilot/base.tf
- envs/<key>/<slug>/tfpilot/requests/.gitkeep

Pure function: (environment_key, environment_slug) => Map<path, content>. No I/O.

Constraints
- Reusable, testable.
- Generic backend block; key injected by workflows.
- No API route logic.

Deliverables
- lib/terraform/envSkeleton.ts
- Unit tests for each file
- Manual: call with dev/ai-agent, assert 5 entries

Do NOT change unrelated code.
```

---

### Chunk 5.2 Prompt

```
CURSOR AGENT — Phase 5 Chunk 5.2: Deploy validation + GitHub safety checks

Goal
Add deploy validation logic used by POST /api/environments/:id/deploy.

This chunk must verify environment deploy eligibility and fail closed if GitHub state cannot be verified.

Scope
- lib/environments/isEnvironmentDeployed.ts (new)
- lib/environments/checkDeployBranch.ts (new)
- lib/github/* helpers if needed
- tests/unit/isEnvironmentDeployed.test.ts (new)

Behaviour

Input
- environment_id
- environment_key
- environment_slug
- repo_full_name

Checks

1. ENV_ROOT existence
Compute:

envs/<environment_key>/<environment_slug>/

If branch or repository lookup fails → return error ENV_DEPLOY_CHECK_FAILED.

2. Existing deploy PR
Check if an open PR exists for:

deploy/<environment_key>/<environment_slug>

If found → treat as already deploying.

3. Deployed detection
Environment is considered deployed if:

envs/<key>/<slug>/backend.tf exists in the repository default branch.

4. Fail-closed behaviour
If GitHub lookup fails (API error, rate limit, auth failure):

Return:
503 { error: "ENV_DEPLOY_CHECK_FAILED" }

Do NOT allow deploy to continue.

Return shape

{
  deployed: boolean,
  deployPrOpen: boolean,
  envRootExists: boolean
}

Constraints
- Do NOT create branches
- Do NOT create PRs
- Do NOT write files
- This chunk performs validation only

Deliverables
- helper functions implemented
- tests covering:
  - deployed environment
  - undeployed environment
  - open deploy PR
  - GitHub lookup failure → ENV_DEPLOY_CHECK_FAILED
- tests added to runInvariants

Manual verification
Simulate:

isEnvironmentDeployed("dev","ai-agent")

Expected outputs:

deployed: true | false
deployPrOpen: true | false
envRootExists: true | false

Stop after implementation and report:
- files changed
- test results
- example helper output.
```

---

### Chunk 5.3 Prompt

```
CURSOR AGENT — Phase 5 Chunk 5.3: Implement POST /api/environments/:id/deploy

Goal
Implement the deploy route that materializes an environment from its template.

This route creates a deploy branch, commits the environment skeleton files, and opens a PR.

Scope
- app/api/environments/[id]/deploy/route.ts (new)
- lib/github/createDeployBranch.ts (optional helper)
- lib/github/createDeployPR.ts (optional helper)
- tests/api/environmentDeployRoute.test.ts (new)

------------------------------------------------

Precondition (MUST)

Before any mutation, call:

isEnvironmentDeployed(token, {
  environment_id,
  environment_key,
  environment_slug,
  repo_full_name
})

Handle responses:

if ok=false
→ return 503
{ error: "ENV_DEPLOY_CHECK_FAILED" }

if deployed=true
→ return 409
{ error: "ENV_ALREADY_DEPLOYED" }

if deployPrOpen=true
→ return 409
{ error: "ENV_DEPLOY_IN_PROGRESS" }

Only continue when:

deployed=false
deployPrOpen=false

------------------------------------------------

Race condition guard (CRITICAL)

Before creating the branch:

Check if branch already exists:

deploy/<environment_key>/<environment_slug>

If it exists:

→ return 409
{ error: "ENV_DEPLOY_IN_PROGRESS" }

This prevents concurrent deploy calls from creating duplicate deploy branches.

------------------------------------------------

Deploy Flow

1. Load environment record
2. Validate template_id
3. Generate skeleton:

envSkeleton(environment_key, environment_slug, template_id)

4. Create branch:

deploy/<environment_key>/<environment_slug>

5. Commit skeleton files from envSkeleton

6. Create PR:

base: main
head: deploy/<environment_key>/<environment_slug>

7. Return response:

{
  deploy: {
    pr_number,
    pr_url,
    branch_name,
    commit_sha
  }
}

------------------------------------------------

Atomic rollback contract

If ANY step fails after files are generated:

Rollback in this order:

1. Delete all created request files
2. Delete deploy branch if it was created

Never leave a partial deploy branch.

------------------------------------------------

Constraints

Do NOT dispatch Terraform workflows here.
The deploy PR itself triggers the plan workflow.

Do NOT modify request lifecycle logic.

------------------------------------------------

Tests

tests/api/environmentDeployRoute.test.ts

Test cases:

- successful deploy
- deploy blocked when environment already deployed
- deploy blocked when deploy PR already open
- GitHub failure → ENV_DEPLOY_CHECK_FAILED
- rollback executed when PR creation fails

------------------------------------------------

Manual verification

POST /api/environments/:id/deploy

Expected response:

{
  "deploy": {
    "pr_number": 42,
    "pr_url": "...",
    "branch_name": "deploy/dev/ai-agent",
    "commit_sha": "abc123"
  }
}

------------------------------------------------

After implementation report:

- files changed
- test results
- example deploy response
- example rollback behaviour
```

---

### Chunk 6.1 Prompt

```
CURSOR AGENT — Expose Environment Deploy Detection

Goal
Expose environment deploy status using the existing deploy validation helper.

Deploy status is already determined by:

isEnvironmentDeployed()

which checks:

envs/<environment_key>/<environment_slug>/backend.tf

This chunk should expose that status for UI consumption.

Scope
- lib/environments/getEnvironmentDeployStatus.ts (new helper)
- app/api/environments/[id]/route.ts (or equivalent environment fetch route)
- tests/unit/getEnvironmentDeployStatus.test.ts

Implementation

Create helper:

getEnvironmentDeployStatus(token, environment)

Call:

isEnvironmentDeployed(token, {
  environment_id,
  environment_key,
  environment_slug,
  repo_full_name
})

Return shape:

{
  deployed: boolean,
  deployPrOpen: boolean,
  envRootExists: boolean
}

Fail-closed behaviour

If GitHub lookup fails:

return

{
  deployed: false,
  error: "ENV_DEPLOY_CHECK_FAILED"
}

Constraints

- Do NOT add DB flags
- Do NOT introduce new deploy detection rules
- MUST reuse isEnvironmentDeployed()
- Do NOT check *_req_*.tf files
- backend.tf remains the canonical deploy signal

Deliverables

- helper exposing deploy status
- environment API includes deploy status
- unit tests verifying:
  - deployed
  - deploy in progress
  - not deployed
  - GitHub failure → fail closed

Manual verification

GET /api/environments/:id

Response includes:

{
  deployed: true,
  deployPrOpen: false
}
```

---

### Chunk 6.2 Prompt

```
CURSOR AGENT — UI Gating: Block New Request Until Env Deployed

Goal
Block "New Request" until an environment is deployed.

Environment deploy status must come from:

isEnvironmentDeployed()

via the environment API.

Scope
- Environment detail page
- Create request entry point

Behaviour

Fetch environment deploy status.

Rules:

if deployed=true AND deployPrOpen=false
→ allow "New Request"

if deployPrOpen=true
→ disable button
→ show message:
"Environment deployment in progress"

if deployed=false
→ disable button
→ show message:
"Environment must be deployed before creating resources"

Fail-closed

If deploy check fails (ENV_DEPLOY_CHECK_FAILED):

→ disable button
→ show message:
"Cannot verify deploy status"

Constraints

- No DB deploy flag
- Do NOT check *_req_*.tf files
- Use deploy status from API only
- Must fail-closed

Deliverables

- UI gating logic
- deploy status surfaced in API
- manual verification:

env not deployed → New Request disabled  
deploy PR open → disabled  
deploy merged → enabled
```

---

### Chunk 7.1 Prompt

```
CURSOR AGENT — Phase 7 / Chunk 7.1: Deploy Error Code Invariant Tests

Goal
Add invariant tests covering ALL deploy error codes for POST /api/environments/:id/deploy per docs/ENVIRONMENT_TEMPLATES_DELTA.md and current Model 2 behavior.

Error codes + expected HTTP status (route-level):
- INVALID_ENV_TEMPLATE → 400
- ENV_ALREADY_DEPLOYED → 409
- ENV_DEPLOY_IN_PROGRESS → 409 (deploy branch exists OR deploy PR open)
- ENV_DEPLOY_CHECK_FAILED → 503 (fail-closed when GitHub checks fail / token missing / API error)

Also add an “atomic rollback” unit test at createDeployPR level:
- When PR creation fails AFTER branch ref updated + commit created:
  - rollback commit created using baseTreeSha
  - branch ref updated to rollback commit
  - branch delete attempted AFTER revert step
  - original error rethrown
(Do NOT mention “request docs deleted” — deploy does not create S3 request docs.)

Scope
- tests/invariants/deployErrors.test.ts (new)
- tests/api/environmentDeployRoute.test.ts (extend if preferred)
- tests/unit/createDeployPR.test.ts (extend rollback assertions only if missing)

Test strategy
- Route-level tests MUST assert:
  - HTTP status
  - JSON body { error: "<CODE>" }
- Mock all dependencies: getEnvironmentById, getSession/token, isEnvironmentDeployed, envSkeleton, createDeployPR, GitHub fetch helpers.
- No real GitHub/S3 calls.

Constraints
- Each error code must have at least 1 route-level test.
- ENV_DEPLOY_IN_PROGRESS must be tested for BOTH cases:
  (a) deployPrOpen=true
  (b) DeployBranchExistsError (branch exists without PR)
- Keep changes strictly within test files (and minimal test wiring in tests/runInvariants.ts if required).

Deliverables
- New/updated test file(s)
- npm run test:invariants passes
- Brief summary: list tests added and what each asserts
Do NOT change unrelated code.
```
