# Environment Templates Parity — Implementation Plan

**Authoritative:** `docs/ARCHITECTURE_DELTA_ENV_TEMPLATES_PARITY.md`

> **Until Step 7, create-environment continues using static env templates; S3 env templates are not used by env creation yet.**

---

## Scope

- S3-backed env templates with index + per-doc layout (parity with request templates)
- Admin CRUD + seed + public list/detail endpoints
- Symmetric prefixes: `request-templates/`, `environment-templates/`
- **Out of scope:** UI, Terraform execution in app, Postgres changes, `validateTemplateId` / `envSkeleton` S3 resolver (deferred to Step 7 / next delta)

## Invariants (must not break)

- S3 request doc canonical
- Terraform runs only in GitHub Actions
- Model 2 env root structure unchanged
- Deployed detection via exact `backend.tf` existence
- Fail-closed on GitHub errors
- Lifecycle derived from facts only

---

## Step 0 — Request Templates prefix switch (prerequisite)

**Goal:** Change request templates S3 prefix from `templates/` → `request-templates/`. No migration of old objects; reseed into new prefix.

**Prerequisite statement:** Request templates prefix changes from `templates/` → `request-templates/`. No migration. Old `templates/*` objects become unused.

### Files to change

| File | Change |
|------|--------|
| `lib/templates-store.ts` | `PREFIX = "request-templates/"`; JSDoc for `getTemplatesIndex` → `request-templates/index.json` |

### Implementation notes

- Single source of truth: no other files hardcode S3 paths; all routes use `templates-store` functions.
- After deploy, run `POST /api/request-templates/admin/seed` to populate `request-templates/*`. Old `templates/*` objects can be left or deleted manually.

### Checklist

- [ ] Search codebase for `"templates/"`; confirm only `lib/templates-store.ts` uses it (PREFIX constant). No other file should reference S3 path prefixes.

### Acceptance checks

| Action | Expected |
|--------|----------|
| Before reseed: `GET /api/request-templates` (authenticated) | `[]` |
| `POST /api/request-templates/admin/seed` (admin) | 201 `{ created: [...], skipped: [] }` |
| After reseed: `GET /api/request-templates` (authenticated) | Seeded templates from `request-templates/*` |
| After reseed: admin routes (create, disable, hard delete) | Work correctly against `request-templates/*` |

- **Safety:** Run seed after deploy; list returns `[]` until then.

---

### Cursor prompt (Step 0)

```
Update lib/templates-store.ts:
1. Change PREFIX from "templates/" to "request-templates/"
2. Update JSDoc for getTemplatesIndex to say "Read request-templates/index.json. Returns [] if the key does not exist."

Before committing: search codebase for "templates/" and confirm only lib/templates-store.ts uses it. No other files need changes. Request-template routes use this store exclusively. After deploy, run POST /api/request-templates/admin/seed to populate request-templates/*.
```

---

## Step 1 — Env templates store layer

**Goal:** New `lib/env-templates-store.ts` with prefix `environment-templates/`. Index missing → `[]`; doc missing → throw (NoSuchKey). Enforce "docs first, then index" for create/seed.

### Files to change

| File | Change |
|------|--------|
| `lib/env-templates-store.ts` | **New.** Mirror `lib/templates-store.ts`; prefix `environment-templates/`; types for env template shape (`EnvTemplateIndexEntry`, `StoredEnvTemplate`). Seed/create: write docs first, then index. |

### Implementation notes

- Types: `EnvTemplateIndexEntry` = `{ id, label, enabled, updatedAt, version? }`; `StoredEnvTemplate` = `{ id, label?, description?, modules: { module, order, defaultConfig? }[], enabled, createdAt, updatedAt, version }`.
- S3 paths: `environment-templates/index.json`, `environment-templates/<id>.json` only. No `templates/environment/*`.
- `getEnvTemplatesIndex()`: NoSuchKey → `[]`. `getEnvTemplate(id)`: NoSuchKey → throw (caller returns 404).
- **List contract:** Callers that iterate index and fetch docs must handle missing doc: skip item, log warn, continue. **Detail contract:** Fetch by id → missing doc → 404.
- `createEnvTemplate` / `createEnvTemplateWithId`: write doc, then update index (docs first, index last).

### Acceptance checks

| Action | Expected |
|--------|----------|
| `getEnvTemplatesIndex()` when index missing | `[]` |
| `getEnvTemplate("blank")` when doc missing | Throws (NoSuchKey or equivalent) |

---

### Cursor prompt (Step 1)

```
Create lib/env-templates-store.ts mirroring lib/templates-store.ts.

Requirements:
- PREFIX = "environment-templates/"
- Types: EnvTemplateIndexEntry { id, label, enabled, updatedAt, version? }; StoredEnvTemplate { id, label?, description?, modules: { module, order, defaultConfig? }[], enabled, createdAt, updatedAt, version }
- getEnvTemplatesIndex(): NoSuchKey → []
- getEnvTemplate(id): throws on NoSuchKey. List callers: fetch each doc, on missing skip + log warn.
- createEnvTemplate, createEnvTemplateWithId: write doc first, then index (docs-first write order per delta)
- Export: getEnvTemplatesIndex, getEnvTemplate, createEnvTemplate, createEnvTemplateWithId, updateEnvTemplate, disableEnvTemplate, enableEnvTemplate, deleteEnvTemplate

Use same S3 client pattern as templates-store (BUCKET = env.TFPILOT_TEMPLATES_BUCKET).
```

---

## Step 2 — Env templates admin CRUD routes

**Goal:** Admin CRUD at `/api/environment-templates/admin`, `/admin/[id]`, `/admin/[id]/delete`. Gate with `requireAdminByEmail()`. Soft disable via DELETE; hard delete via POST `.../delete`. 500 on storage failures.

### Files to change

| File | Change |
|------|--------|
| `app/api/environment-templates/admin/route.ts` | **New.** GET list (index, incl disabled), POST create |
| `app/api/environment-templates/admin/[id]/route.ts` | **New.** GET, PUT, DELETE (soft), PATCH |
| `app/api/environment-templates/admin/[id]/delete/route.ts` | **New.** POST hard delete |

### Implementation notes

- Mirror `app/api/request-templates/admin/**` structure. Use `requireAdminByEmail()` from `lib/auth/admin`.
- NoSuchKey in store → 404 `{ error: "Not found" }`. Storage errors → 500.
- Create payload: `{ label?, description?, modules: { module, order, defaultConfig? }[], enabled? }`. Server assigns id, timestamps, version.

### Acceptance checks

| Action | Expected |
|--------|----------|
| `GET /api/environment-templates/admin` (non-admin) | 404 |
| `GET /api/environment-templates/admin` (admin) | 200 `[]` (no seed yet) |
| `POST /api/environment-templates/admin` (admin) `{ label: "Test", modules: [] }` | 201 template object |
| `DELETE /api/environment-templates/admin/[id]` (admin) | 200, template `enabled: false` |
| `POST /api/environment-templates/admin/[id]/delete` (admin) | 200 `{ ok: true }`, template removed |

---

### Cursor prompt (Step 2)

```
Create env templates admin CRUD routes mirroring app/api/request-templates/admin/**.

New files:
- app/api/environment-templates/admin/route.ts: GET (list index), POST (create)
- app/api/environment-templates/admin/[id]/route.ts: GET, PUT, DELETE (soft disable), PATCH (enable/partial)
- app/api/environment-templates/admin/[id]/delete/route.ts: POST (hard delete)

Use requireAdminByEmail(), getEnvTemplatesIndex, getEnvTemplate, createEnvTemplate, updateEnvTemplate, disableEnvTemplate, enableEnvTemplate, deleteEnvTemplate from lib/env-templates-store.
NoSuchKey → 404. Storage errors → 500. Log prefix [env-templates/admin].
```

---

## Step 3 — Env templates seed endpoint

**Goal:** `POST /api/environment-templates/admin/seed`. Reads `config/environment-templates.ts`; if index exists → 409 `ENV_TEMPLATES_ALREADY_INITIALIZED`. Writes docs first, then index.

### Files to change

| File | Change |
|------|--------|
| `app/api/environment-templates/admin/seed/route.ts` | **New.** Check index exists → 409. Read `environmentTemplates` from config; write docs then index via store. |
| `lib/env-templates-store.ts` | Add `envTemplatesIndexExists()` (HeadObject; return false on NoSuchKey), `seedEnvTemplatesFromConfig(templates)`: if index exists throw; write each doc; write index last. |

### Implementation notes

- **Seed guard:** `getEnvTemplatesIndex()` returns `[]` on NoSuchKey and must **not** be used to infer "not initialized". Use `envTemplatesIndexExists()` (HeadObject on `environment-templates/index.json`): if true → 409; else → proceed.
- Write order: for each template from config, write `environment-templates/<id>.json`; only then write `environment-templates/index.json`. Per delta seed invariant.

### Acceptance checks

| Action | Expected |
|--------|----------|
| `POST /api/environment-templates/admin/seed` (admin, first run) | 200 `{ created: ["blank","baseline-ai-service",...] }` |
| `POST /api/environment-templates/admin/seed` (admin, second run) | 409 `{ error: "ENV_TEMPLATES_ALREADY_INITIALIZED" }` |
| `GET /api/environment-templates/admin` (admin) | 200 with 4 entries |

- **Safety:** Never use `getEnvTemplatesIndex()` for seed guard; use `envTemplatesIndexExists()` only.

---

### Cursor prompt (Step 3)

```
Create app/api/environment-templates/admin/seed/route.ts.

Requirements:
- requireAdminByEmail()
- Add envTemplatesIndexExists() in store (HeadObject on environment-templates/index.json; return false on NoSuchKey). If exists → 409 { error: "ENV_TEMPLATES_ALREADY_INITIALIZED" }
- Read environmentTemplates from config/environment-templates.ts
- Call store.seedEnvTemplatesFromConfig(environmentTemplates): write environment-templates/<id>.json for each, then environment-templates/index.json last
- Return 200 { created: [...] } (parity with request-templates seed; no skipped field)

Mirror app/api/request-templates/admin/seed/route.ts structure but with env-specific idempotent guard (409 when already initialized).
```

---

## Step 4 — Env templates public endpoints

**Goal:** `GET /api/environment-templates` (enabled only, S3); `GET /api/environment-templates/[id]` (404 if disabled/missing). Session required (401 if not authenticated).

### Files to change

| File | Change |
|------|--------|
| `app/api/environment-templates/route.ts` | Replace config import with `getEnvTemplatesIndex`, `getEnvTemplate` from store. Filter enabled; return full docs. Index missing → `[]`. |
| `app/api/environment-templates/[id]/route.ts` | **New.** Session required. Index + enabled check; getTemplate; 404 if disabled or missing. |

### Implementation notes

- **Auth: unchanged vs current.** Current `app/api/environment-templates/route.ts` requires session (401 if not). Step 4 preserves this; no breaking change.
- **List:** read `environment-templates/index.json` → filter enabled → fetch `environment-templates/<id>.json` for each. If doc missing → skip item, log warn, continue.
- **Detail:** read `environment-templates/<id>.json`; missing doc → 404.

### Acceptance checks

| Action | Expected |
|--------|----------|
| `GET /api/environment-templates` (no session) | 401 |
| `GET /api/environment-templates` (session, after seed) | 200 array of 4 templates |
| `GET /api/environment-templates` (session, index has id but doc missing) | 200 array excluding that item (skip + log) |
| `GET /api/environment-templates/blank` (session) | 200 template object |
| `GET /api/environment-templates/nonexistent` (session) | 404 |
| `GET /api/environment-templates/blank` (session, doc missing) | 404 |
| Disable `blank` via admin DELETE, then `GET /api/environment-templates/blank` | 404 |

---

### Cursor prompt (Step 4)

```
Update app/api/environment-templates/route.ts to read from S3 via lib/env-templates-store:
- getEnvTemplatesIndex (environment-templates/index.json), filter enabled, getEnvTemplate (environment-templates/<id>.json) for each; if doc missing → skip item, log warn, continue
- Index missing → []
- Session required; 401 if not authenticated (unchanged vs current)

Create app/api/environment-templates/[id]/route.ts:
- Session required; 401 if not
- getEnvTemplatesIndex, find entry by id, check enabled → 404 if disabled/missing
- getEnvTemplate(id) fetches environment-templates/<id>.json → 404 on NoSuchKey
- Return template JSON
```

---

## Step 5 — Validation hardening

**Goal:** Enforce module identity = `ModuleRegistryEntry.type`; `defaultConfig` keys only from `regEntry.fields`; reject unknown top-level fields; size limits.

### Files to change

| File | Change |
|------|--------|
| `lib/env-templates-store.ts` | Add validation inside `createEnvTemplate`, `updateEnvTemplate`, `seedEnvTemplatesFromConfig`. Reject unknown top-level keys. For each module: `module` must match `moduleRegistry.find(m => m.type === mod.module)`; `defaultConfig` keys must be subset of `regEntry.fields.map(f => f.name)`. Size limits. |
| `app/api/environment-templates/admin/route.ts` | Thin wrapper: call store; map validation errors → 400 `ENV_TEMPLATE_VALIDATION_FAILED`. |
| `app/api/environment-templates/admin/[id]/route.ts` | Thin wrapper: call store; map validation errors → 400. |

### Implementation notes

- **Single enforcement point:** Validation lives in store-layer create/update/seed. Routes remain thin (auth + call store + map errors to HTTP).
- Size limits: e.g. max 50 modules, max 100 keys in defaultConfig, max 10KB per value. Unknown top-level: allow only `id`, `label`, `description`, `modules`, `enabled`.

### Acceptance checks

| Action | Expected |
|--------|----------|
| POST with `modules: [{ module: "invalid-module", order: 1 }]` | 400 `ENV_TEMPLATE_VALIDATION_FAILED` |
| POST with `defaultConfig: { unknown_key: 1 }` for a module | 400 (key not in registry fields) |
| POST with valid payload | 201 |

---

### Cursor prompt (Step 5)

```
Add strict validation to env templates. Single enforcement point: store layer.

1. lib/env-templates-store.ts: validate inside createEnvTemplate, updateEnvTemplate, seedEnvTemplatesFromConfig
   - Top-level: only id, label, description, modules, enabled (reject unknown)
   - modules[].module must exist in moduleRegistry (moduleRegistry.find(m => m.type === mod.module))
   - modules[].defaultConfig keys must be subset of regEntry.fields.map(f => f.name)
   - Size limits: max 50 modules, max 100 defaultConfig keys per module
   - Throw validation error; routes map to 400 ENV_TEMPLATE_VALIDATION_FAILED

2. Routes: thin wrappers only; no inline validation; map store validation errors → 400
```

---

## Step 6 — Tests

**Goal:** Store unit tests (NoSuchKey, write order); route tests (create/list/get/disable/hard delete/seed); negative cases (invalid module, invalid defaultConfig, seed already initialized).

### Files to change

| File | Change |
|------|--------|
| `tests/unit/envTemplatesStore.test.ts` | **New.** NoSuchKey → []; get missing throws; create writes doc then index (mock S3 or integration). |
| `tests/api/envTemplatesAdminRoute.test.ts` | **New.** Admin CRUD flows; seed 409. |
| `tests/unit/envTemplatesValidation.test.ts` | **New.** Invalid module, invalid defaultConfig keys. |
| `tests/runInvariants.ts` | Register new test modules. |

### Implementation notes

- Reuse pattern from `tests/api/requestTemplatesRoute.test.ts`, `tests/unit/requestTemplates.test.ts`.
- API tests may skip without dev server (TEST_SKIP_API=1).

### Acceptance checks

| Test | Expected |
|------|----------|
| `npm run test:invariants` | All pass |
| Store: getIndex when missing | Returns [] |
| Route: seed twice | Second → 409 |

---

### Cursor prompt (Step 6)

```
Add tests for env templates parity:

1. tests/unit/envTemplatesStore.test.ts: getEnvTemplatesIndex NoSuchKey → []; getEnvTemplate missing throws
2. tests/api/envTemplatesAdminRoute.test.ts: mirror requestTemplatesRoute; admin CRUD; seed returns 409 on second run
3. tests/unit/envTemplatesValidation.test.ts: invalid module → validation fails; invalid defaultConfig key → fails

Register in tests/runInvariants.ts. Follow patterns in tests/unit/requestTemplates.test.ts and tests/api/requestTemplatesRoute.test.ts.
```

---

## Step 7 — Deferred (explicitly NOT in this plan)

**Goal:** Document as next delta. Do **not** implement in this plan.

| Item | Status |
|------|--------|
| `lib/environments/validateTemplateId` | Still uses config. Switch to S3 resolver (valid ids = S3 index) in a later delta. |
| `lib/environments/envSkeleton` | Still uses `environmentTemplates.find()`. Switch to S3 resolver in a later delta. |

**Product reality:** Until Step 7 is done, create-environment and deploy flows continue using static env templates; S3 env templates are **not** used by env creation yet. The S3-backed API serves the new data; consumers (`validateTemplateId`, `envSkeleton`) are updated in a later delta.

---

## Sequencing summary

| Step | Description |
|------|-------------|
| 0 | Request templates prefix → `request-templates/`; reseed |
| 1 | `lib/env-templates-store.ts` |
| 2 | Admin CRUD routes |
| 3 | Seed endpoint |
| 4 | Public GET list + GET [id] |
| 5 | Validation hardening |
| 6 | Tests |
| 7 | **Deferred:** validateTemplateId + envSkeleton S3 resolver |
