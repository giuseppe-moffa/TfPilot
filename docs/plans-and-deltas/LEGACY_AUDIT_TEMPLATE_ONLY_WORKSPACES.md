# Legacy Audit: Template-Only Workspaces (pre–Phase 5)

**Purpose:** Identify every remaining code path that depends on the pre–template-only model, old environment template system, or compatibility shims. No code changes; audit only.

---

## 1. Remaining legacy dependencies

| File path | Symbol / pattern | Why legacy | Safe to remove |
|-----------|------------------|------------|----------------|
| `app/api/environments/[id]/deploy/route.ts` | `validateTemplateIdOrThrow`, `template_id ?? "blank"` | Environment deploy still validates template_id via old env-templates index and allows "blank" fallback for display; then requires template_version/template_inputs and calls envSkeleton (which uses S3). | **Later** — remove when environment deploy route is retired or switched to workspace-only. |
| `app/api/environments/route.ts` | `validateTemplateIdOrThrow`, `INVALID_ENV_TEMPLATE` | POST create environment validates template_id with old validator; uses createEnvironment (workspace bridge). | **Later** — when environment create is removed or fully workspace-based. |
| `lib/workspaces/validateTemplateId.ts` | `validateTemplateIdOrThrow`, `isValidTemplateId`, `getEnvTemplatesIndex`, `envTemplatesIndexExists`, `environmentTemplates`, `"blank"` | Validates against env-templates-store (S3 old layout) + static config; allows "blank". Used by env deploy/create and by workspace validate (indirectly via env shim). | **Later** — only after all callers use workspace-templates-store and blank is gone. |
| `lib/environments/validateTemplateId.ts` | `validateTemplateIdOrThrow`, `INVALID_ENV_TEMPLATE`, `isValidTemplateId` | Shim: delegates to workspace validateTemplateId, re-maps error codes to ENV_* for API compatibility. | **Later** — with environment route removal. |
| `lib/env-templates-store.ts` | entire module | Old S3 layout `environment-templates/<org_id>/`, getEnvTemplate, getEnvTemplatesIndex, seedEnvTemplatesFromConfig, deleteEnvTemplate, envTemplatesIndexExists. | **Later** — after all consumers migrated to workspace-templates-store. |
| `app/api/workspace-templates/[id]/route.ts` | `getEnvTemplatesIndex`, `getEnvTemplate` | GET single template by id uses old env-templates-store (org-scoped index + doc). | **Phase 5B** — replace with getWorkspaceTemplate(id, latest_version) or similar from workspace-templates-store. |
| `app/api/workspace-templates/admin/route.ts` | `getEnvTemplatesIndex` | Admin list uses old index. | **Phase 5B** — switch to getWorkspaceTemplatesIndex() or remove if admin uses new store. |
| `app/api/workspace-templates/admin/seed/route.ts` | `seedEnvTemplatesFromConfig`, `environmentTemplates`, `envTemplatesIndexExists` | Seeds old env-templates S3 layout from static config. | **Later** — replace with seed for templates/workspaces/ or remove when using only S3 seed. |
| `app/api/workspace-templates/admin/[id]/route.ts` | `getEnvTemplate` | Admin get one template from old store. | **Phase 5B**. |
| `app/api/workspace-templates/admin/[id]/delete/route.ts` | `deleteEnvTemplate` | Deletes from old env-templates store. | **Phase 5B** — or remove if new store has no delete. |
| `config/environment-templates.ts` | `environmentTemplates`, `id: "blank"` | Static config for old template list and seed; includes "blank". | **Later** — when seed and validateTemplateId no longer need it. |
| `lib/environments/envSkeleton.ts` | `template_inputs ?? {}` | Defensive fallback only; not a template fallback. | **Keep** — harmless. |
| `lib/db/environments.ts` | `template_inputs: ws.template_inputs ?? {}`, `params.template_inputs ?? {}` | Normalization for optional field; createEnvironment already requires template_id/template_version. | **Keep** — safe defaults. |

---

## 2. Compatibility layers still present

| File path | What it bridges | Phase 5 remove? |
|-----------|-----------------|------------------|
| `lib/environments/envSkeleton.ts` | Environment deploy → workspaceSkeleton (params: template_id, template_version, template_inputs); maps INVALID_ENV_TEMPLATE for env API. | **Yes** — when environment deploy is removed or calls workspaceSkeleton directly. |
| `lib/environments/validateTemplateId.ts` | Environment API error codes (INVALID_ENV_TEMPLATE, ENV_TEMPLATES_NOT_INITIALIZED) ← workspace validateTemplateId. | **Yes** — with environment routes. |
| `lib/db/environments.ts` | Environment type and getEnvironmentById / createEnvironment / etc. wrap workspace DB (toEnvironment(ws)). createEnvironment calls createWorkspace with required template_*. | **Later** — keep until no callers use Environment or createEnvironment. |
| `app/api/environments/[id]/deploy/route.ts` | Reads “environment” (workspace), requires template_version/template_inputs, calls envSkeleton → workspaceSkeleton. Still uses validateTemplateIdOrThrow(template_id) and template_id ?? "blank" for the initial trim. | **Phase 5B** — remove template_id ?? "blank" and validateTemplateIdOrThrow from this route; require non-blank template_id and optionally resolve via S3 only, or retire route. |
| `app/api/environments/route.ts` | POST create environment → createEnvironment (workspace bridge); validates template_id with validateTemplateIdOrThrow. | **Phase 5B** — when environment create is deprecated. |

---

## 3. Execution-path leftovers

- **Environment deploy** (`app/api/environments/[id]/deploy/route.ts`): Still on execution path. Uses `template_id = (envRow.template_id ?? "blank").trim()`, then `validateTemplateIdOrThrow(template_id, session.orgId)` (old env-templates index + "blank" allowed). Then requires template_version and template_inputs and calls envSkeleton → workspaceSkeleton. So template load is S3 (workspaceSkeleton), but validation and fallback are legacy.
- **Environment create** (`app/api/environments/route.ts`): Uses validateTemplateIdOrThrow (old index + blank), then createEnvironment. Execution path for creating workspaces via legacy API.
- **Workspace create** (`app/api/workspaces/route.ts`): Uses getWorkspaceTemplatesIndex + getWorkspaceTemplate (S3 new store); no validateTemplateIdOrThrow in workspace route. Clean.
- **Workspace deploy** (`app/api/workspaces/[id]/deploy/route.ts`): Uses pinned template_id/template_version/template_inputs and getWorkspaceTemplate + workspaceSkeleton. No blank. Clean.
- **GET /api/workspace-templates** (root): Uses getWorkspaceTemplatesIndex (S3). Clean.
- **GET /api/workspace-templates/[id]**: Uses getEnvTemplatesIndex + getEnvTemplate (old store). Legacy execution path for single-template fetch (e.g. catalogue, admin).
- **Drift plan** (`app/api/github/drift-plan/route.ts`): Uses getEnvironmentById (workspace bridge). Not template resolution; just env lookup. Keep until drift is workspace-based.

---

## 4. Non-execution leftovers (tests, admin, config)

| File path | Purpose | Legacy aspect |
|-----------|---------|---------------|
| `tests/unit/validateTemplateIdOrThrow.test.ts` | Unit tests for validateTemplateIdOrThrow | Uses seedEnvTemplatesFromConfig, "blank" resolves, old index. |
| `tests/unit/envTemplatesStore.test.ts` | env-templates-store behavior | getEnvTemplatesIndex, getEnvTemplate, getEnvTemplateIfExists, seedEnvTemplatesFromConfig, deleteEnvTemplate, envTemplatesIndexExists. |
| `tests/unit/envTemplatesValidation.test.ts` | seedEnvTemplatesFromConfig validation | seedEnvTemplatesFromConfig. |
| `tests/api/environmentDeployErrorsRoute.test.ts` | Deploy route error contract | seedEnvTemplatesFromConfig for one case; BASE_ENV_ROW template_id "blank"; getEnvironmentById. |
| `tests/api/environmentActionRoute.test.ts` | Deploy/destroy auth | mockEnvRow template_id "blank"; getEnvironmentById. |
| `tests/unit/projectAccessEnforcement.test.ts` | Deploy permission | Environment mocks with template_id "blank". |
| `tests/invariants/requestEnvironment.test.ts` | resolveRequestEnvironment | getEnvironmentById (Environment type). |
| `tests/invariants/deployErrors.test.ts` | Error code contract | isValidTemplateId("blank" === true), INVALID_ENV_TEMPLATE. |
| `tests/api/environmentTemplatesRoute.test.ts` | GET list + [id] | Fetches `/api/environment-templates`; app only has `/api/workspace-templates` — test path may be wrong or base URL rewrites. Asserts list + enabled only + [id] 404. |
| `tests/api/envTemplatesAdminRoute.test.ts` | Admin + seed + delete | Fetches admin/seed/delete under environment-templates path. |
| `tests/api/environmentsCreateRoute.test.ts` | POST create environment | template_id "blank", assert template_id === "blank". |
| `tests/invariants/environmentsCreate.test.ts` | create body validation | isValidTemplateId("blank" allowed). |
| `tests/unit/environmentTemplates.test.ts` | Static config | environmentTemplates, blank in list. |
| `tests/unit/requestTemplates.test.ts` | Request UI templates | id "blank" in mock; getRequestTemplate("blank"). Request template, not workspace template. |
| `app/requests/new/page.tsx` | New request UI | id "blank" in template option; t.id === "blank" display logic. Request context. |
| `config/environment-templates.ts` | Static template list | Defines "blank" and baseline-*; used by validateTemplateId (VALID_IDS) and admin seed. |

---

## 5. Template document fields still ignored in render

- **template.modules[].source**: Validated in workspace-templates-store and validate.ts; **not** used in emitted Terraform. Skeleton uses `getModuleSource(request.module)` → `../../../modules/<module>` (mod.id). So template source (e.g. registry path) is not written to .tf.
- **template.modules[].version**: Validated; **not** used in emitted Terraform. No `version = "x"` in module block.
- **template.modules[].config**: **Used** — interpolated with template_inputs and passed to registry compute + generateModel2RequestFile.
- **template.inputs**: **Used** — variables.tf and terraform.tfvars generated from template.inputs and workspace.template_inputs.
- **workspace.template_inputs**: **Used** — passed into workspaceSkeleton, used for interpolation and tfvars.

---

## 6. Recommended cleanup plan

### Phase 5A — Safe removals now

- **None** recommended without one more end-to-end pass. All legacy usages are either (1) still on an active execution path (env deploy/create, workspace-templates admin/[id]), or (2) tests that document current behavior. Removing them without switching callers would break deploy, create, or admin.

### Phase 5B — Removals after one more end-to-end verification

1. **Environment deploy route legacy bits**  
   In `app/api/environments/[id]/deploy/route.ts`: Remove `template_id ?? "blank"`; require non-empty template_id and fail with 400/500 if missing. Optionally remove `validateTemplateIdOrThrow` and rely on envSkeleton/getWorkspaceTemplate to fail for invalid/missing template. Verify env deploy E2E (or retire route).

2. **GET /api/workspace-templates/[id]**  
   Replace getEnvTemplatesIndex + getEnvTemplate with workspace-templates-store (e.g. getWorkspaceTemplatesIndex + getWorkspaceTemplate(id, latest_version) or explicit version). Update catalogue and any callers. Then remove env-templates-store usage from this route.

3. **workspace-templates admin routes**  
   `admin/route.ts`, `admin/[id]/route.ts`, `admin/[id]/delete/route.ts`, `admin/seed/route.ts`: Either migrate to workspace-templates-store (new S3 layout) and new seed flow, or mark as deprecated and remove once no longer used.

4. **lib/workspaces/validateTemplateId.ts**  
   Switch to workspace-templates-store only: remove getEnvTemplatesIndex, envTemplatesIndexExists, environmentTemplates; remove "blank". Validate template_id against getWorkspaceTemplatesIndex() (or index existence) only. Then update or remove callers that relied on "blank" (env deploy/create, tests).

5. **lib/environments/validateTemplateId.ts + envSkeleton**  
   Remove when environment deploy/create are retired or no longer use these shims.

6. **config/environment-templates.ts**  
   Remove when seed and validateTemplateId no longer depend on it; or replace with a minimal seed source for the new store.

### Keep temporarily

- **lib/db/environments.ts** (getEnvironmentById, createEnvironment, toEnvironment, Environment type): Required by environment deploy/destroy, environment create, resolveRequestEnvironment, drift-plan. Keep until those are migrated to workspace-only.
- **envSkeleton**: Required by environment deploy. Keep until that route is removed or refactored to call workspaceSkeleton directly.
- **INVALID_ENV_TEMPLATE / ENV_TEMPLATES_NOT_INITIALIZED**: Keep while environment routes return these codes; tests and clients may depend on them.
- **Tests** that mock "blank" or env template store: Keep until Phase 5B removes or changes the behavior they assert; then update or remove tests.

### Summary

- **Execution path:** Environment deploy and environment create still use validateTemplateIdOrThrow and (for deploy) template_id ?? "blank". GET /api/workspace-templates/[id] and admin routes use env-templates-store. Workspace create/deploy and GET /api/workspace-templates (list) are on the new S3 model.
- **Compatibility:** envSkeleton, lib/environments/validateTemplateId, and lib/db/environments are the main shims; remove when environment APIs are retired or fully workspace-based.
- **Template fields:** template.modules[].source and .version are validated but not used in generated Terraform; template.inputs and workspace.template_inputs are used.
