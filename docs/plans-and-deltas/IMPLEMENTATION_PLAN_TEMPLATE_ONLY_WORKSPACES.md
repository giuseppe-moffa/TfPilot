# Implementation Plan: Template-Only Workspaces

## Overview

This plan implements the approved architecture delta **ARCHITECTURE_DELTA_TEMPLATE_ONLY_WORKSPACES.md**. It introduces a fresh-start template subsystem: S3-only, versioned, parameterized templates; no blank/minimal workspace creation; workspaces store `template_id`, `template_version`, `template_inputs`.

**Core invariants:**
- S3 is the **only** canonical template source
- Template resolution is **deterministic** (id + version → exact document)
- Workspaces **pin** exact template version; template revisions do not affect existing workspaces
- No template may have **empty modules**
- Blank workspace creation is **fully removed**

---

## Assumptions

- **tfpilot-templates** S3 bucket exists and is configured (`TFPILOT_TEMPLATES_BUCKET`)
- Initial templates are **seeded into S3 before** enabling the new workspace creation flow
- No legacy compatibility: old static config and `env-templates-store` layout are **replaced** by the new `templates/workspaces/` layout
- Fresh-start preference: keep migration minimal. Add `template_inputs` with `DEFAULT '{}'`; no backfill step.

---

## Phase 1 — S3 Template Store

**Goal:** Define the new template store with `templates/workspaces/` layout. Provide loader, resolver, and index reader. No legacy dual-read.

### Files affected

| File | Action |
|------|--------|
| `lib/workspace-templates-store.ts` | **Create** |

**Do not reference `env-templates-store`.** The new store must be independent — a clean subsystem with no coupling to the legacy layout.

### Key tasks

- Define S3 layout:
  - `templates/workspaces/<templateId>/<version>.json` — template document
  - `templates/workspaces/index.json` — list of template ids + latest versions
- Implement `getWorkspaceTemplate(templateId, version)` → fetch document, parse, return
- Implement `getWorkspaceTemplatesIndex()` → fetch index, return entries
- Define TypeScript types for template document shape: id, name, version, modules (array of `{ id, source, version, config }`), inputs, description?, category?, icon?, recommended?
- Use `TFPILOT_TEMPLATES_BUCKET` (tfpilot-templates)
- Seed script or manual procedure: write at least one real baseline template (expanded module schema) to S3 before Phase 3

### Definition of done

- `getWorkspaceTemplate(id, version)` returns template or throws (404)
- `getWorkspaceTemplatesIndex()` returns index entries
- At least one template exists at `templates/workspaces/<id>/<version>.json`
- No reads from static config or `environment-templates/` layout

---

## Phase 2 — Template Schema + Validation

**Goal:** Implement schema validation for template documents and input values. Enforce non-empty modules, required/default handling.

### Files affected

| File | Action |
|------|--------|
| `lib/workspace-templates-store.ts` | Extend with validation |
| `lib/workspace-templates/validate.ts` | **Create** (or colocate in store) |

### Key tasks

- Define schema for template document:
  - Required: id, name, version, modules (non-empty array of module objects)
  - Optional: inputs (array of input defs), description, category, icon, recommended
- Validate `modules`: array, length ≥ 1; each module has id, source, version, config; reject legacy string-array format
- Define input definition schema: key, label, type, required, default
- Implement `validateTemplateDocument(obj)` → throws if invalid
- Implement `validateTemplateInputs(template, userInputs)`:
  - All required inputs present
  - Types match (string/number/boolean)
  - Apply defaults for missing optional inputs
- Validate template document on load in `getWorkspaceTemplate`

### Definition of done

- Invalid template documents rejected with clear errors
- Invalid or missing required input values rejected
- Default values applied for optional inputs
- Templates with `modules: []` rejected

---

## Phase 3 — Workspace DB + API Changes

**Goal:** Add `template_inputs` to workspaces; require `template_id`, `template_version`, `template_inputs` on create; resolve template from S3 only; persist template provenance.

### Files affected

| File | Action |
|------|--------|
| `migrations/YYYYMMDD_workspace_template_inputs.sql` | **Create** |
| `lib/db/workspaces.ts` | Add `template_inputs`; require `template_id`, `template_version` |
| `app/api/workspaces/route.ts` | Require template fields; validate; resolve from S3; remove blank fallback |
| `app/api/workspaces/[id]/deploy/route.ts` | Resolve template by id+version from workspace row; pass `template_version` to skeleton |
| `lib/workspaces/validateTemplateId.ts` | Replace with S3 resolver: `validateTemplateIdAndVersionOrThrow(id, version)` |

### Key tasks

- Migration: add `template_inputs JSONB DEFAULT '{}'`; no backfill — fresh-start minimal migration
- Update `Workspace` type and `createWorkspace` to accept `template_inputs`
- POST /api/workspaces body: require `template_id`, `template_version`, `template_inputs`
- Validate: resolve template from `workspace-templates-store`; validate `template_inputs` against template schema
- Reject if template has empty modules
- Persist `template_id`, `template_version`, `template_inputs` on workspace
- Remove `template_id ?? "blank"` fallback in deploy route; require workspace to have valid template_id + template_version
- Deploy route: read template from workspace row; resolve full template from S3 by id+version; pass to workspaceSkeleton

### Definition of done

- Workspace create rejects missing template_id, template_version, or invalid template_inputs
- Workspace create rejects templates with empty modules
- All template resolution from S3 only (no static config)
- Workspace row stores template_id, template_version, template_inputs

---

## Phase 4 — workspaceSkeleton Refactor

**Goal:** Remove BLANK_TEMPLATE; generate variables.tf and terraform.tfvars; require template; resolve from S3 by id+version.

### Files affected

| File | Action |
|------|--------|
| `lib/workspaces/workspaceSkeleton.ts` | Refactor |
| `lib/workspaces/workspaceSkeleton.ts` | Add variables.tf + terraform.tfvars generation |

### Key tasks

- Remove `BLANK_TEMPLATE` constant and `tid === "blank"` branch
- Add `template_version` and `template_inputs` to `WorkspaceSkeletonParams`
- Resolve template via `getWorkspaceTemplate(templateId, templateVersion)` from workspace-templates-store (replace getEnvTemplate)
- Use **expanded module schema**: each module has `id`, `source`, `version`, `config`; emit request files from config; interpolate `${var.foo}` in config with template_inputs
- Generate `variables.tf` from template `inputs` schema (variable declarations)
- Generate `terraform.tfvars` from `template_inputs` (user values + defaults)
- Keep baseline files: backend.tf, providers.tf, versions.tf, tfpilot/base.tf, module request files

### Definition of done

- No BLANK_TEMPLATE or blank branch
- variables.tf and terraform.tfvars present in skeleton output
- Template resolved only from S3 by id+version
- Modules resolved from expanded schema (id, source, version, config); config supports `${var.x}` interpolation
- Module request files emit correct config from template

---

## Phase 5 — Template Catalogue API

**Goal:** Provide API for template listing and metadata for UI (template selection + input form generation).

### Files affected

| File | Action |
|------|--------|
| `app/api/workspace-templates/route.ts` | Update to use workspace-templates-store; support version in response |
| `app/api/workspace-templates/[id]/route.ts` | Update; add version param or latest semantics |
| New: `app/api/workspace-templates/[id]/[version]/route.ts` | **Create** (optional; if needed for exact version fetch) |

### Key tasks

- GET /api/workspace-templates: list from `getWorkspaceTemplatesIndex()`; return id, name, version(s), description, category, icon, recommended, inputs schema
- GET /api/workspace-templates/[id]: return template metadata for latest version (or require version query param)
- Ensure response includes `inputs` schema for dynamic form generation
- Remove dependency on `env-templates-store` and static config for workspace templates

### Definition of done

- Template list and single-fetch use workspace-templates-store only
- UI can build template selector and Configure Template Inputs form from API response

---

## Phase 6 — Workspace Creation UI

**Goal:** Require template selection; remove blank option; add Configure Template Inputs step; add **Preview Infrastructure** step; send template_id, template_version, template_inputs.

### Files affected

| File | Action |
|------|--------|
| `app/projects/[projectId]/workspaces/new/page.tsx` | Remove blank; add input step; add preview step; send template provenance |
| `app/workspaces/new/page.tsx` | Same (if still used) |
| `lib/workspaces/templatePreview.ts` | **Create** — generate preview data from template + inputs (no Terraform) |

### Key tasks

- Remove `blankTemplate` and all `id === "blank"` logic
- Require template selection before proceeding
- Add step: **Configure Template Inputs** — render form from template `inputs` schema
- Add step: **Preview Infrastructure** — show "Resources to be created" from `template.modules`; show resolved variables; derive display names from module registry or module id
- Validate user inputs client-side before submit (required fields, types)
- On submit: send `template_id`, `template_version`, `template_inputs` to POST /api/workspaces
- Fetch templates from GET /api/workspace-templates; no fallback to static config

**Preview (simple version):** Generate from template only — no Terraform run, no temp workspace. Map `modules[].id` to human-readable labels (e.g. "ecr_repo" → "ECR Repository"). Advanced version (real plan) is out of scope for initial release.

### Definition of done

- Blank option removed
- Template selection required
- Configure Template Inputs step present and functional
- **Preview Infrastructure step** shows modules and variables before Create
- Create request includes template_id, template_version, template_inputs

---

## Phase 7 — Workspace Runs + Preview Plan

**Goal:** Introduce Workspace Run model; workspace creation triggers a **preview run** (terraform plan); plan stored in S3; workspace UI shows plan before Deploy and run history.

### Files affected

| File | Action |
|------|--------|
| `migrations/YYYYMMDD_workspace_runs.sql` | **Create** — workspace_runs table |
| `lib/db/workspaceRuns.ts` | **Create** — CRUD for runs |
| `lib/workspace-run-store.ts` | **Create** — write/read plan output to S3 |
| `app/api/workspaces/[id]/runs/route.ts` | **Create** — list runs for workspace |
| `app/api/workspaces/[id]/runs/[runId]/route.ts` | **Create** — get run + plan output |
| `app/api/workspaces/[id]/runs/preview/route.ts` | **Create** (optional) — trigger or get latest preview run |
| `app/api/workspaces/route.ts` | After create: create preview run record; trigger preview workflow |
| Infra repo: `.github/workflows/workspace-preview-plan.yml` | **Create** — triggered after workspace creation |
| `app/projects/[projectId]/workspaces/[workspaceId]/page.tsx` | Add Preview Plan section; add Runs history section |

### Run model

- **DB table `workspace_runs`:** run_id, workspace_id, type (preview \| deploy \| request \| drift \| destroy), status, created_at; optional resource_summary (JSONB), apply_status.
- **Run status enum:** `pending` \| `running` \| `success` \| `failed` \| `cancelled`.
- **Resource summary shape:** `{ add: number, change: number, destroy: number }` — for UI (e.g. "Plan: 6 to add, 0 to change, 0 to destroy").
- **S3 layout:** `runs/<workspace_id>/<run_id>/plan.txt` — plan output for any run type.

### Key tasks

- Migration: create `workspace_runs` table with run_id, workspace_id, type, status, created_at, resource_summary (JSONB), apply_status.
- Implement run store: write plan to S3 at `runs/<workspace_id>/<run_id>/plan.txt`; read for API.
- Workspace create: after creating workspace and generating skeleton, create a **preview run** record (type: preview, status: pending); trigger CI workflow (or dispatch) with workspace_id and run_id.
- **New CI workflow `workspace-preview-plan.yml`:** Triggered after workspace creation. Receives workspace_id, run_id. Checks out repo; terraform init; terraform plan; uploads plan output to S3 at `runs/<workspace_id>/<run_id>/plan.txt`; updates run status (e.g. success/failed).
- API: GET /api/workspaces/:id/runs — list runs; GET /api/workspaces/:id/runs/:runId — get run + plan body (from S3).
- Workspace UI: **Preview Plan** section — show latest preview run plan (summary, diff, resources to add/change/destroy). **Runs history** — list preview, deploy, request runs with type and status.
- **Request runs (later):** When request plan/apply executes, record a run with type=request. No change to request lifecycle; just create run record and store plan in S3. Can be done in Phase 9 or follow-up.

### Definition of done

- Workspace creation creates a preview run and triggers preview workflow.
- Preview workflow runs terraform init + plan; stores plan to S3.
- Workspace UI shows plan before user clicks Deploy; shows run history.

---

## Phase 8 — Tests

**Goal:** Cover template validation, API behavior, skeleton generation, workspace runs, and removal of blank paths.

### Files affected

| File | Action |
|------|--------|
| `tests/unit/workspaceTemplatesStore.test.ts` | **Create** |
| `tests/unit/workspaceTemplateValidation.test.ts` | **Create** |
| `tests/api/workspaceCreateRoute.test.ts` | **Create** or extend |
| `tests/unit/workspaceSkeleton.test.ts` | **Create** or extend |
| `tests/**/*.test.ts` | Update/remove tests asserting blank workspace behavior |

### Key tasks

- Template document validation: valid/invalid schemas, expanded module schema, empty modules rejected
- Template input validation: required missing, type mismatches, defaults applied
- Workspace create API: require template_id/version/inputs; reject invalid; persist correctly
- workspaceSkeleton: generates variables.tf, terraform.tfvars; uses expanded module schema; no blank path
- Template preview: generates correct resource list from template modules
- Workspace runs: preview run created on workspace create; plan stored and retrievable
- Remove or update tests that assert blank workspace creation
- End-to-end: create workspace from real template → deploy flow

### Definition of done

- All new tests pass
- No tests depend on blank template
- E2E happy path for template-based creation verified

---

## Phase 9 — Deploy Run + Plan Visibility

**Goal:** Deploy creates a **deploy run**; plan output stored under unified run storage (`runs/`); workspace UI shows deploy run in run history. (See delta: Workspace Run model.)

**Run storage:** S3 only, unified layout `runs/<workspace_id>/<run_id>/plan.txt`. Reuse `lib/workspace-run-store.ts` from Phase 7.

### Files affected

| File | Action |
|------|--------|
| Infra repo workflow (e.g. `.github/workflows/deploy.yml`) | Extend to run `terraform plan`; create **deploy run** record; write plan to S3 at `runs/<workspace_id>/<run_id>/plan.txt`; on apply, update run with apply_status |
| `lib/db/workspaceRuns.ts` | Create deploy run on deploy trigger; update status when plan/apply complete |
| `app/api/workspaces/[id]/deploy/route.ts` | Create deploy run record when deploy PR is triggered |
| `app/projects/[projectId]/workspaces/[workspaceId]/page.tsx` | Deploy run appears in Runs history; plan summary/diff/apply status for selected run |

### Key tasks

- Deploy PR CI: run `terraform plan`; create or update deploy run; write plan to S3 at `runs/<workspace_id>/<run_id>/plan.txt`.
- On apply (after PR merge): update deploy run with apply_status.
- API: runs list and run detail already in Phase 7; deploy run is just type=deploy.
- Workspace UI: Runs history shows deploy run(s); selecting a run shows plan summary, diff, apply status.

### Definition of done

- Deploy creates a deploy run; plan stored under `runs/`.
- Deploy run visible in workspace Runs history with plan and apply status.

---

## Phase 10 — Aggressive Legacy Cleanup + Docs

**Goal:** Once the new template and run flow is proven, **aggressively delete** all legacy env template code. No retention. Update documentation.

### Files affected

| File | Action |
|------|--------|
| `config/environment-templates.ts` | **Delete** |
| `lib/env-templates-store.ts` | **Delete** |
| `lib/environments/envSkeleton.ts` | **Delete** (if still present; workspaceSkeleton is canonical) |
| `lib/environments/validateTemplateId.ts` | **Delete** (if still present; workspace validateTemplateId is canonical) |
| `app/api/workspace-templates/admin/seed/route.ts` | Replace to seed new layout (`templates/workspaces/`) |
| `app/api/environments/route.ts` | **Delete** or deprecate (if envs superseded by workspaces) |
| `app/api/environments/[id]/deploy/route.ts` | **Delete** or deprecate |
| `docs/GLOSSARY.md`, `docs/API.md` | Update template terminology |
| `docs/SCREAMING_ARCHITECTURE.md` | Update template store references |

### Key tasks

- **Delete** `config/environment-templates.ts`
- **Delete** `lib/env-templates-store.ts` — no retention; workspace flows use `workspace-templates-store` only
- **Delete** any remaining env-specific skeleton/validate shims; workspace paths are canonical
- Verify no imports of env-templates-store or environment-templates anywhere
- Replace seed route: new seed writes to `templates/workspaces/` with versioned layout
- Update docs: template-only model, S3 layout, workspace template provenance

### Definition of done

- All legacy env template code **deleted**
- No references to env-templates-store, environment-templates, or blank template
- Documentation reflects new template system

---

## Explicit Notes

- **S3 canonical:** All template reads come from S3. No static config at runtime.
- **Deterministic resolution:** `(template_id, template_version)` → single immutable document.
- **Workspace pinning:** Workspaces store exact version; template updates do not affect them.
- **No empty modules:** Every template must have `modules.length >= 1`.
- **Blank removed:** No blank workspace creation in any form.
- **Seed before enable:** Seed real baseline templates into S3 **before** enabling the new workspace create flow.
- **Expanded module schema:** Modules use `{ id, source, version, config }`; config supports `${var.x}` interpolation.
- **Template versioning lifecycle:** Existing workspaces stay pinned; "Upgrade template" is explicit future UI action (not in initial scope).
- **Workspace Runs:** Unified run model (preview, deploy, request, drift, destroy); storage `runs/<workspace_id>/<run_id>/plan.txt` (Phase 7, 9).
- **Preview run:** Workspace creation triggers preview run; user sees Terraform plan before Deploy (Phase 7).
- **Deploy run:** Deploy creates deploy run; plan and apply status in run history (Phase 9).
- **Preview before create:** User sees modules and variables before Create; simple version from template only (Phase 6).

---

## Recommended Execution Order

1. **Phase 1** — S3 store + seed one template (with expanded module schema). Verify `getWorkspaceTemplate` and index work.
2. **Phase 2** — Add validation (including module object schema). Run Phase 1 + 2 together if desired.
3. **Phase 3** — DB migration + API. Workspace create and deploy use new store. Deploy route passes template_version + template_inputs.
4. **Phase 4** — workspaceSkeleton. Remove blank; use expanded module schema; generate variables.tf/terraform.tfvars. Test deploy flow.
5. **Phase 5** — Template API. UI can list and fetch templates (including recommended).
6. **Phase 6** — UI. End-to-end create from template.
7. **Phase 7** — Workspace Runs + Preview Plan. Run model (DB + S3 runs/); workspace creation triggers preview run; workflow workspace-preview-plan.yml; UI Preview Plan + Runs history.
8. **Phase 8** — Tests. Add and update tests; remove blank assertions; workspace runs tests.
9. **Phase 9** — Deploy run. Deploy creates deploy run; plan stored under runs/; deploy run in Runs history.
10. **Phase 10** — Aggressive cleanup. Delete all legacy env template code once new flow proven; update docs.

**Verification at each phase:** Run existing tests; add phase-specific tests before moving on.
