# Architecture Delta: Env Template S3 Resolution (Create Environment)

## Status
- Owner:
- Date:
- Target release:
- Related:
  - docs/plans-and-deltas/ARCHITECTURE_DELTA_ENV_TEMPLATES_PARITY.md
  - docs/plans-and-deltas/ENV_TEMPLATES_PARITY_IMPLEMENTATION_PLAN.md
  - docs/INVARIANTS.md
  - docs/SYSTEM_OVERVIEW.md

## Problem
Env templates are now S3-backed (admin CRUD + public read), but **create-environment** still resolves templates from static config:
- `lib/environments/validateTemplateId` — validates against static config list
- `lib/environments/envSkeleton` — looks up template via `environmentTemplates.find()` in config

So admin changes to S3 templates do not affect environment creation or deploy.

## Goals
- Create-environment resolves env templates from **S3** (authoritative)
- Template validation uses **S3 index** ids (enabled-only) for non-blank templates
- envSkeleton uses **S3 template doc** to generate skeleton (except built-in `"blank"`)
- Clear behavior when templates not initialized: blank env always allowed; non-blank → 503

## Non-Goals
- No UI/catalogue work
- No changes to deploy flow, backend.tf detection, GitHub logic
- No Postgres changes
- No "fallback to static config" (explicitly prohibited)

## Invariants (must not break)
- Terraform runs only in GitHub Actions
- Model 2 env roots unchanged
- Deployed detection via exact backend.tf on default branch
- S3 request docs canonical; Postgres projection only
- No parsing Terraform files

## Current Implementation (Extracted from Repo)

### 1. lib/environments/validateTemplateId.ts

**Behavior:** Sync, pure. Builds `VALID_IDS = Set(["blank", ...environmentTemplates.map(t => t.id)])` from `@/config/environment-templates`.

- Returns `true` for `null` or `undefined` (omitted) — treated as valid/optional
- Returns `false` for empty string, whitespace-only, non-string, or unknown ids
- Returns `true` for `"blank"` and any id present in static config

**Error semantics:** Does not throw or return error codes. Callers interpret `false` and return `400 { error: "INVALID_ENV_TEMPLATE" }`.

### 2. lib/environments/envSkeleton.ts

**Behavior:** Pure function, no I/O. Imports `environmentTemplates` from `@/config/environment-templates`.

- Resolves template via `environmentTemplates.find((t) => t.id === template_id)`
- If no match → throws `Error("Unknown template_id: <id>")`
- Uses `template.modules` sorted by `order`, resolves each `module` against `moduleRegistry` from `@/config/module-registry`
- Produces env root structure: `backend.tf`, `providers.tf`, `versions.tf`, `tfpilot/base.tf`, `tfpilot/requests/.gitkeep`, plus module request files

**Error semantics:** Throws on unknown template_id. No structured error codes; deploy route validates via `isValidTemplateId` before calling envSkeleton.

### 3. POST /api/environments — templateId consumption

**Path:** `app/api/environments/route.ts`

**Flow:**
- Body: `project_key`, `environment_key`, `environment_slug`, `template_id?` (optional)
- `validateCreateEnvironmentBody(body)` does not validate `template_id`
- `isValidTemplateId(body.template_id)` → if false, returns `400 { error: "INVALID_ENV_TEMPLATE" }`
- Stored: `template_id` = trimmed string if provided and non-empty; else `null`
- Auth: session required (401); viewer role → 403

**Note:** No `environmentTemplateId` field; API uses `template_id` only.

### 4. POST /api/environments/:id/deploy — template resolution

**Path:** `app/api/environments/[id]/deploy/route.ts`

**Flow:**
- Reads `template_id` from DB env row; defaults to `"blank"` if `null`
- `isValidTemplateId(template_id)` → if false, returns `400 { error: "INVALID_ENV_TEMPLATE" }`
- Calls `envSkeleton({ environment_key, environment_slug, template_id, project_key })` to generate files
- Auth: session + admin role required

### 5. Existing error code conventions

| Code | HTTP | Usage |
|------|------|-------|
| `INVALID_ENV_TEMPLATE` | 400 | POST /api/environments, deploy route — unknown/empty template_id |
| `ENV_TEMPLATES_ALREADY_INITIALIZED` | 409 | Seed when index already exists |
| `ENV_TEMPLATE_VALIDATION_FAILED` | 400 | Admin CRUD — invalid modules, label, id format |
| Storage/load failures | 500 | env-templates routes (parity with request-templates) |
| `ENV_DEPLOY_CHECK_FAILED` | 503 | Deploy when GitHub check fails |
| DB unavailable | 503 | POST /api/environments when DB not configured |

### 6. Auth for env template reads

**Paths:** `app/api/environment-templates/route.ts`, `app/api/environment-templates/[id]/route.ts`

- Both use `getSessionFromCookies()`; no session → `401 { error: "Not authenticated" }`
- No role check for public list/detail (any authenticated user)

---

## Proposed Behavior Changes

### 1) validateTemplateId

**Current:** Validates against static config list.

**New API:** `validateTemplateIdOrThrow(template_id: string | null | undefined): Promise<void>`

- **No throw** for `null`, `undefined`, or `"blank"` — built-in virtual template; no S3 lookup.
- **Throws** on invalid: `INVALID_ENV_TEMPLATE` (id unknown/disabled/empty when index present) or `ENV_TEMPLATES_NOT_INITIALIZED` (S3 index missing for non-blank id).
- Replaces `isValidTemplateId`; removes boolean-return pattern.

**Call-site updates:**
- **POST /api/environments** (`app/api/environments/route.ts`): Replace `if (!isValidTemplateId(body.template_id)) { return 400 }` with `try { await validateTemplateIdOrThrow(body.template_id) } catch (e) { map to 400 or 503 per error code }`.
- **Deploy route** (`app/api/environments/[id]/deploy/route.ts`): Same — replace `isValidTemplateId(template_id)` with `validateTemplateIdOrThrow(template_id)`; catch and map `INVALID_ENV_TEMPLATE` → 400, `ENV_TEMPLATES_NOT_INITIALIZED` → 503.

### 2) envSkeleton

**Current:** `environmentTemplates.find(...)` in config.

**New:**
- For `"blank"` (or equivalent): use built-in virtual template (modules: `[]`); no S3 lookup.
- For non-blank ids: load template doc from S3 by id (via `getEnvTemplate` or equivalent); use template.modules (and defaultConfig) to produce env skeleton.
- If template missing/disabled → same semantics as validateTemplateIdOrThrow (fail-closed).
- If S3 index missing for non-blank id → `ENV_TEMPLATES_NOT_INITIALIZED`.

### 3) Blank env when templates not initialized

**Decision:** Avoid bricking env creation. **"blank" is a built-in virtual template.**

- **Definition:** `"blank"` is a built-in virtual template (modules: `[]`). Not a static config fallback; it is always valid without S3.
- **Normalization:** `template_id` null or undefined → treat as `"blank"`.
- **When S3 index is missing:**
  - `template_id` null/undefined/`"blank"` → valid; env creation and deploy succeed (blank skeleton, no module files).
  - Any non-blank `template_id` → 503 `ENV_TEMPLATES_NOT_INITIALIZED`.
- **Rationale:** Unblocks blank-env creation before seed; non-blank still requires S3.

---

## Error Semantics (Decisions)

**Error-mapping rule (template resolution):**
- **Index missing** (NoSuchKey on `environment-templates/index.json`) when resolving non-blank id → **503** `ENV_TEMPLATES_NOT_INITIALIZED`.
- **Index present** but id invalid or disabled → **400** `INVALID_ENV_TEMPLATE`.
- **Non-NoSuchKey S3 failures** (timeout, AccessDenied, generic errors) → **500** (e.g. `{ error: "Failed to load environment templates" }`).

| Code | HTTP | Response body | When |
|------|------|---------------|------|
| `ENV_TEMPLATES_NOT_INITIALIZED` | **503** | `{ error: "ENV_TEMPLATES_NOT_INITIALIZED" }` | S3 index missing; non-blank template resolution (create or deploy) |
| `INVALID_ENV_TEMPLATE` | 400 | `{ error: "INVALID_ENV_TEMPLATE" }` | Template id unknown, disabled, or empty string (client error); index present |
| `ENV_TEMPLATE_DISABLED` | — | — | **Unused.** Fold into `INVALID_ENV_TEMPLATE` (400) |
| Storage/load (non-NoSuchKey) | 500 | `{ error: "Failed to load environment templates" }` or equivalent | S3 unreachable, transient error |

**ENV_TEMPLATES_NOT_INITIALIZED — 503 rationale:** Service Unavailable indicates a dependency (S3 templates) is not ready. Aligns with existing 503 usage: "Database not configured or unavailable" (POST /api/environments), `ENV_DEPLOY_CHECK_FAILED`. 409 would imply conflict with existing state; "not initialized" has no conflict.

---

## Authoritative Sources
- **Built-in virtual template:** `"blank"` (modules: `[]`). Always valid; no S3 lookup. Not a static config fallback.
- **Templates canonical store (non-blank):** S3
  - `environment-templates/index.json`
  - `environment-templates/<id>.json`
- Module definitions canonical: `config/module-registry.ts` (ModuleRegistryEntry.type + fields)
- Index existence check: `envTemplatesIndexExists()` in `lib/env-templates-store.ts` (HeadObject; NoSuchKey → false)

---

## Operational Requirements
- Seed must be run before enabling Step 7 (S3 resolution) in prod.
- **Ops runbook snippet:**
  1. Call `POST /api/environment-templates/admin/seed` (admin auth)
  2. Verify `GET /api/environment-templates` returns non-empty list (authenticated)
  3. Confirm create-environment and deploy work

---

## Observability
- Log events:
  - `env_templates.resolve_index` (ok / error)
  - `env_templates.resolve_doc` (ok / error)
- Include `correlationId` / `environment_id` where available

---

## Testing Strategy
- Unit tests:
  - `validateTemplateIdOrThrow`:
    - null/undefined/`"blank"` → ok (no throw) even when index missing
    - non-blank + index initialized + enabled → ok
    - non-blank + index initialized + disabled → throws INVALID_ENV_TEMPLATE
    - non-blank + index missing → throws ENV_TEMPLATES_NOT_INITIALIZED (503)
    - empty string / unknown id (index present) → throws INVALID_ENV_TEMPLATE
  - `envSkeleton`:
    - `"blank"` → no S3 call; produces blank skeleton
    - non-blank → resolves modules from S3 doc
    - non-blank + index missing → ENV_TEMPLATES_NOT_INITIALIZED
- API/integration:
  - POST /api/environments with template_id null/blank: succeeds when index missing (blank env)
  - POST /api/environments with non-blank template_id: 503 when index missing; succeeds after seed
  - Deploy: same rules for blank vs non-blank

---

## Rollout Plan
- Step A: Implement S3 resolver used by validateTemplateId + envSkeleton
- Step B: Add explicit ENV_TEMPLATES_NOT_INITIALIZED error (503)
- Step C: Deploy
- Step D: Run seed in prod
- Step E: Monitor logs; verify create env works

---

## Appendix

### Example request payloads

**POST /api/environments**
```json
{
  "project_key": "default",
  "environment_key": "dev",
  "environment_slug": "ai-agent",
  "template_id": "baseline-ai-service"
}
```

Omit `template_id` or send `null` for blank env.

### Example errors + JSON bodies

| Scenario | HTTP | Body |
|---------|------|------|
| S3 index missing + non-blank template_id | 503 | `{ "error": "ENV_TEMPLATES_NOT_INITIALIZED" }` |
| Index present, invalid/disabled template id | 400 | `{ "error": "INVALID_ENV_TEMPLATE" }` |
| Non-NoSuchKey S3 failure | 500 | `{ "error": "Failed to load environment templates" }` |
