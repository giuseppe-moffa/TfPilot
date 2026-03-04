# Forensic Report: Request Templates (E2E) + Blueprint for Environment Templates

**Scope:** Exact mapping of how request templates work today, gap analysis vs environment templates, and a minimal blueprint for environment-templates parity.

**Constraint:** Report only. No implementation.

---

## 1) Data model & storage (request templates)

### Canonical store

| Aspect | Value |
|--------|-------|
| **Store** | S3 only (no Postgres, no local config for runtime) |
| **Bucket** | `env.TFPILOT_TEMPLATES_BUCKET` (e.g. `tfpilot-templates` per env.example) |
| **Prefix** | `templates/` |
| **Index** | `templates/index.json` — array of `TemplateIndexEntry` |
| **Per-template** | `templates/<id>.json` — full `StoredTemplate` |
| **Enumerated** | Index file; list keys not used |

### Template JSON shape

**Index entry** (`TemplateIndexEntry`):

| Field | Type | Notes |
|-------|------|-------|
| id | string | Stable template id |
| label | string | Display name |
| project | string | Empty = any project |
| environment | string | e.g. dev, prod |
| module | string | e.g. ec2-instance |
| enabled | boolean | Soft-filter |
| updatedAt | string | ISO |
| version? | number | Incremented on update |

**Stored template** (`StoredTemplate`):

| Field | Type | Notes |
|-------|------|-------|
| id | string | |
| label | string | |
| description? | string | |
| project | string | Empty = any project |
| environment | string | |
| module | string | |
| defaultConfig | Record<string, unknown> | Sanitized (derived keys stripped) |
| uiSchema? | Record<string, unknown> | |
| enabled | boolean | |
| createdAt | string | ISO |
| updatedAt | string | ISO |
| version? | number | Default 1 |
| createdBy? | string \| null | Email |
| updatedBy? | string \| null | Email |
| lockEnvironment? | boolean | |
| allowCustomProjectEnv? | boolean | |

**Sanitized keys** (never stored in defaultConfig): `name`, `project`, `environment`, `request_id`.

**Schema versioning:** None. `version` is an incrementing integer for optimistic locking/display only.

**Files:** `lib/templates-store.ts`, `lib/templates-store-seed-defaults.ts`, `config/request-templates.ts` (types + `getRequestTemplate` only; no runtime data).

---

## 2) Admin CRUD flows

### Endpoints

| Route | Method | Purpose | Auth | Storage |
|-------|--------|---------|------|---------|
| `/api/request-templates/admin` | GET | List all (index entries, incl disabled) | Admin (404 if not) | S3 `templates/index.json` |
| `/api/request-templates/admin` | POST | Create (auto-id) | Admin | S3 template + index append |
| `/api/request-templates/admin/[id]` | GET | Get single (full) | Admin | S3 `templates/<id>.json` |
| `/api/request-templates/admin/[id]` | PUT | Update | Admin | S3 overwrite + index patch |
| `/api/request-templates/admin/[id]` | DELETE | Soft disable | Admin | S3 update `enabled=false` |
| `/api/request-templates/admin/[id]` | PATCH | Re-enable (`enabled: true`) or partial update | Admin | S3 update |
| `/api/request-templates/admin/[id]/delete` | POST | Hard delete (remove from index + delete object) | Admin | S3 delete object + index filter |
| `/api/request-templates/admin/seed` | POST | Seed default templates (idempotent) | Admin | S3 create missing only |

### Auth / authorization

- **Admin gate:** `requireAdminByEmail()` in `lib/auth/admin.ts` checks `session.email` against `env.TFPILOT_ADMIN_EMAILS`.
- **Effect:** Non-admin → 404 (opaque, no hint of route existence).

### Error codes

| Condition | Status | Body |
|-----------|--------|------|
| Not authenticated | 401 | `{ error: "Not authenticated" }` |
| Admin check fails | 404 | `{ error: "Not found" }` |
| NoSuchKey (template missing) | 404 | `{ error: "Not found" }` |
| Invalid payload / validation | 400 | `{ error: "<message>" }` |
| Create/update/store error | 400/500 | `{ error: "..." }` |
| Seed create failure | 500 | `{ error, detail, created, skipped }` |

### Files

- `app/api/request-templates/route.ts` — list enabled (public-style)
- `app/api/request-templates/[id]/route.ts` — get single enabled
- `app/api/request-templates/admin/route.ts` — list/create
- `app/api/request-templates/admin/[id]/route.ts` — get/put/delete/patch
- `app/api/request-templates/admin/[id]/delete/route.ts` — hard delete
- `app/api/request-templates/admin/seed/route.ts` — seed
- `lib/templates-store.ts` — S3 read/write
- `lib/auth/admin.ts` — admin gating

---

## 3) Catalogue UI

### Pages & API calls

| Page | API calls | Effects |
|------|-----------|---------|
| `/catalogue` | `GET /api/request-templates/admin` (if admin) else `GET /api/request-templates` | List templates (admin sees all; non-admin sees enabled only) |
| `/catalogue` | `POST /api/request-templates/admin` (create), `DELETE /api/request-templates/admin/[id]` (disable), `PATCH` (enable), `POST /api/request-templates/admin/[id]/delete` (hard delete), `POST /api/request-templates/admin/seed` | Admin CRUD/seed |
| `/catalogue/[id]` | `GET /api/request-templates/admin/[id]` (admin) or `GET /api/request-templates/[id]` (non-admin) | View/edit single template |
| `/catalogue/new` | Same as `/catalogue/[id]` with `id === "new"` | Create new template |
| `/catalogue/[id]` | `PUT /api/request-templates/admin/[id]` | Save edits |
| `/catalogue/[id]` | `POST /api/request-templates/admin` (duplicate) | Duplicate template |

### Response shapes

- **List (admin):** Array of `TemplateIndexEntry`.
- **List (public):** Array of full `StoredTemplate` (enabled only).
- **Single:** Full `StoredTemplate`.

### UI rendering

- **List:** Cards with label, module, project, environment, version, enabled badge; search by label/module/project/environment.
- **Detail:** Form with label, description, project, environment, module, defaultConfig (form or raw JSON), enabled.
- **Client-side filtering:** Search input filters list; no server-side search.

### Files

- `app/catalogue/page.tsx` — list, search, admin actions (disable/enable/delete/seed/duplicate)
- `app/catalogue/[id]/page.tsx` — editor/viewer, module schema from `GET /api/modules/schema`

---

## 4) New Request flow

### Step-by-step user journey

1. **Step 1 — Choose template**
   - User sees cards from `GET /api/request-templates` (enabled only).
   - Optional `?templateId=` → pre-select template, jump to Step 2.
   - Selection sets: `selectedTemplateId`, `project`, `environment`, `moduleName`, `formValues` (from `t.defaultConfig`), `envStep = 2`.

2. **Step 2 — Environment details**
   - User edits: name (environmentName), project, environment (from API `GET /api/environments?project_key=`).
   - On Continue: compute `generatedName` (name + shortId), merge `module defaults` + `template.defaultConfig` + `name` → `formValues`, `envStep = 3`.

3. **Step 3 — Configuration**
   - User edits module config (form fields from `GET /api/modules/schema`).
   - Submit → `POST /api/requests` with payload below.

### Payload produced (client → server)

```json
{
  "environment_id": "<selectedEnvironmentId>",
  "module": "<moduleName>",
  "config": { "name": "<generatedName>", ... },
  "templateId": "<selectedTemplateId> | undefined",
  "environmentName": "<environmentName> | undefined"
}
```

- **Config:** Built from `formValues` via `buildConfig()`. Includes module defaults + template defaults + user edits. `name`/primary key set from `generatedName`.
- **templateId:** Passed through; server stores on request doc for audit; no server-side template resolution.
- **environmentName:** Passed through; stored as `environmentName` on request for display.

### Where template is “resolved”

- **Client-side:** Template provides `module`, `environment`, `project`, `defaultConfig`. These prefill form; user can amend. No server fetch of template on create.
- **Server-side:** `templateId` and `environmentName` are stored as metadata only. Config is normalized/validated via module registry; template defaults are already in `config` from client.

### Files

- `app/requests/new/page.tsx` — full flow
- `config/request-templates.ts` — `getRequestTemplate`, `RequestTemplate` type (client maps API `module` → `moduleKey`)

---

## 5) Request creation enforcement

### Where server validates template usage

- **None.** Server does not resolve or validate `templateId`. It is optional metadata. Invalid `templateId` is accepted and stored.

### Module schema / fieldsMeta

- `lib/requests/validateCreateBody.ts` — requires `environment_id` or `(project_key, environment_key, environment_slug)`, `module`, `config`.
- `app/api/requests/route.ts`:
  - `normalizeConfigKeys` — snake_case
  - `buildModuleConfig(regEntry, config, ctx)` — applies module registry defaults, coerces types, validates required/enum
  - `appendRequestIdToNames` — ensures `name` includes requestId
  - `injectServerAuthoritativeTags` — adds tfpilot tags
  - `validateResourceName` — name format
  - `validatePolicy` — region allowlist

### Final S3 request doc construction

- Built in `app/api/requests/route.ts`. Key fields: `id`, `project_key`, `environment_key`, `environment_slug`, `environment_id`, `module`, `config`, `templateId`, `environmentName`, `receivedAt`, `updatedAt`, `revision`, `status`, `plan`, PR/branch/runs, etc.
- Stored via `saveRequest()` → `lib/storage/requestsStore.ts` → S3 `requests/<id>.json`.

### Derived fields (server-side)

- `moduleRef`, `registryRef`, `rendererVersion`, `render` (renderHash, inputsHash)
- `branchName`, `prNumber`, `prUrl`, `commitSha`, `pr`, `targetOwner`, `targetRepo`, etc.
- `runs.plan` (dispatch attempt)
- Tags injected by `injectServerAuthoritativeTags`

---

## 6) Environment templates parity design

### Current state (env templates)

| Aspect | Value |
|--------|-------|
| Store | `config/environment-templates.ts` (static) |
| API | `GET /api/environment-templates` — returns static array |
| Auth | Session required |
| Create env | `POST /api/environments` accepts `template_id`; validated via `isValidTemplateId` against config |
| UI | No catalogue; no admin CRUD; template selection only in Create Environment flow (if/when implemented) |
| Deploy | `POST /api/environments/:id/deploy` uses `env.template_id` → `envSkeleton` |

### Proposed S3 layout (mirror request templates)

| Key | Entity | Writer | Reader |
|-----|--------|--------|--------|
| `templates/environment/index.json` | Array of `EnvTemplateIndexEntry` | Admin create/update/delete | List |
| `templates/environment/<id>.json` | Full `StoredEnvTemplate` | Admin CRUD | Single |

**Prefix:** `templates/environment/` (same bucket as request templates).

### Proposed API endpoints

| Route | Method | Purpose | Auth | Storage |
|-------|--------|---------|------|---------|
| `/api/environment-templates` | GET | List enabled (for create-env flow) | Session | S3 index + objects |
| `/api/environment-templates/[id]` | GET | Single enabled | Session | S3 |
| `/api/environment-templates/admin` | GET | List all (incl disabled) | Admin | S3 |
| `/api/environment-templates/admin` | POST | Create | Admin | S3 |
| `/api/environment-templates/admin/[id]` | GET | Single (any) | Admin | S3 |
| `/api/environment-templates/admin/[id]` | PUT | Update | Admin | S3 |
| `/api/environment-templates/admin/[id]` | DELETE | Soft disable | Admin | S3 |
| `/api/environment-templates/admin/[id]` | PATCH | Enable / partial update | Admin | S3 |
| `/api/environment-templates/admin/[id]/delete` | POST | Hard delete | Admin | S3 |
| `/api/environment-templates/admin/seed` | POST | Seed defaults | Admin | S3 |

### Proposed template JSON shape (env templates)

```ts
type EnvTemplateIndexEntry = {
  id: string
  label: string
  enabled: boolean
  updatedAt: string
  version?: number
}

type StoredEnvTemplate = {
  id: string
  label: string
  description?: string
  modules: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  version?: number
  createdBy?: string | null
  updatedBy?: string | null
}
```

Per-module `defaultConfig` overrides allowed in UI (user amends when creating env).

### Create Environment UX (parity with New Request)

- **Step 1:** Select env template from catalogue-style list (`GET /api/environment-templates`).
- **Step 2:** User edits `environment_slug`, `project_key`, `environment_key`; optionally module config overrides per template module.
- **Step 3:** `POST /api/environments` with `template_id` + optional `module_overrides` (if we extend payload).
- Deploy: `POST /api/environments/:id/deploy` uses `template_id` to load template (S3 or config fallback), `envSkeleton` generates files.

### Integration points to change

- `lib/environments/validateTemplateId.ts` — resolve from S3 index instead of config.
- `lib/environments/envSkeleton.ts` — resolve template from S3 (or config as fallback during migration).
- `app/api/environment-templates/route.ts` — switch from config to S3.
- New: `app/api/environment-templates/admin/**`, `lib/env-templates-store.ts` (or similar).
- New: Catalogue-like UI for env templates (or extend `/catalogue` with tab) + Create Environment form with template picker.

---

## 7) Explicit answers

### A) Where are request templates stored (S3 path, format)?

- **Bucket:** `TFPILOT_TEMPLATES_BUCKET` (e.g. `tfpilot-templates`).
- **Paths:** `templates/index.json`, `templates/<id>.json`.
- **Format:** JSON. Index = array of `TemplateIndexEntry`. Per-template = `StoredTemplate`.

### B) How does admin CRUD work today (files + endpoints)?

- **Endpoints:** `app/api/request-templates/admin/route.ts`, `admin/[id]/route.ts`, `admin/[id]/delete/route.ts`, `admin/seed/route.ts`.
- **Store:** `lib/templates-store.ts` — getTemplatesIndex, getTemplate, createTemplate, createTemplateWithId, updateTemplate, disableTemplate, enableTemplate, deleteTemplate.
- **Auth:** `requireAdminByEmail()`; non-admin → 404.

### C) How does catalogue show templates (files + endpoints)?

- **Pages:** `app/catalogue/page.tsx`, `app/catalogue/[id]/page.tsx` (includes `/catalogue/new`).
- **APIs:** `GET /api/request-templates/admin` (admin) or `GET /api/request-templates` (non-admin); `GET /api/request-templates/[id]` or `admin/[id]`; `GET /api/modules/schema` for form fields.
- **Rendering:** Cards (label, module, env, version, enabled); search; admin: edit, duplicate, disable/enable, delete, seed.

### D) How does template selection influence POST /api/requests (exact payload + server behavior)?

- **Payload:** `{ environment_id, module, config, templateId?, environmentName? }`. Template affects only client-side prefilling; server receives final `config` already merged.
- **Server:** Stores `templateId` and `environmentName` as metadata. No template fetch or validation. Config validated via module registry only.

### E) What would be the equivalent for environment templates (exact new/changed endpoints + S3 layout)?

- **S3:** `templates/environment/index.json`, `templates/environment/<id>.json` in same bucket.
- **New endpoints:** `GET/POST /api/environment-templates/admin`, `GET/PUT/DELETE/PATCH /api/environment-templates/admin/[id]`, `POST /api/environment-templates/admin/[id]/delete`, `POST /api/environment-templates/admin/seed`.
- **Changed:** `GET /api/environment-templates` → read from S3 (enabled only). `GET /api/environment-templates/[id]` → single enabled.
- **Consumers:** `validateTemplateId`, `envSkeleton` → resolve from S3 (with config fallback during migration).

---

## Gap list (actionable, unambiguous)

| # | Gap | Location | Action |
|---|-----|----------|--------|
| 1 | Env templates are static config | `config/environment-templates.ts` | Add S3 store; migrate or dual-source |
| 2 | No admin CRUD for env templates | — | Add `app/api/environment-templates/admin/**` mirroring request-templates |
| 3 | No S3 env template store | — | Add `lib/env-templates-store.ts` (or extend templates-store) with prefix `templates/environment/` |
| 4 | `validateTemplateId` uses config | `lib/environments/validateTemplateId.ts` | Resolve valid IDs from S3 index when S3 enabled |
| 5 | `envSkeleton` uses config | `lib/environments/envSkeleton.ts` | Resolve template from S3 when S3 enabled |
| 6 | No catalogue UI for env templates | `app/catalogue/*` | Add env templates tab or `/catalogue/env`; reuse patterns from request catalogue |
| 7 | Create Environment has no template picker in UI | `app/environments/*` | Add Create Environment form/dialog with template selection from `GET /api/environment-templates` |
| 8 | No seed for env templates | — | Add `POST /api/environment-templates/admin/seed` + seed defaults |
| 9 | No soft disable / enable for env templates | — | Add DELETE (disable) and PATCH (enable) on admin route |
| 10 | No hard delete for env templates | — | Add `POST /api/environment-templates/admin/[id]/delete` |
