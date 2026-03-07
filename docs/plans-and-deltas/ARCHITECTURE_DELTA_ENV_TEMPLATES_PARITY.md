# Architecture Delta: Environment Templates Parity (S3 + Admin CRUD)

## Findings (code references used)

| Area | Paths |
|------|-------|
| S3 helpers | `lib/templates-store.ts` — `getTemplatesIndex`, `getTemplate`, `createTemplate`, `createTemplateWithId`, `updateTemplate`, `disableTemplate`, `enableTemplate`, `deleteTemplate`, `streamToString` |
| Request template paths | `request-templates/index.json`, `request-templates/<id>.json` (bucket: `TFPILOT_TEMPLATES_BUCKET`) |
| Admin gating | `lib/auth/admin.ts` — `requireAdminByEmail()`; `lib/config/env.ts` — `TFPILOT_ADMIN_EMAILS` |
| Request template routes | `app/api/request-templates/route.ts`, `app/api/request-templates/[id]/route.ts`, `app/api/request-templates/admin/route.ts`, `app/api/request-templates/admin/[id]/route.ts`, `app/api/request-templates/admin/[id]/delete/route.ts`, `app/api/request-templates/admin/seed/route.ts` |
| Environment templates (current) | `config/environment-templates.ts`, `app/api/environment-templates/route.ts` |
| Create/deploy flow | `app/api/environments/route.ts`, `app/api/environments/[id]/deploy/route.ts`, `lib/environments/validateTemplateId.ts`, `lib/environments/envSkeleton.ts` |
| Module registry | `config/module-registry.ts` — `moduleRegistry`, `ModuleRegistryEntry.type`; validation: `moduleRegistry.find((m) => m.type === mod.module)` |
| Invariants | `docs/INVARIANTS.md` — INV-PLAT-1 (Terraform only GA), INV-PLAT-2 (S3 canonical) |
| Tests | `tests/unit/environmentTemplates.test.ts`, `tests/api/environmentTemplatesRoute.test.ts`, `tests/unit/moduleRegistry.test.ts` |

---

## Status
- Owner:
- Date:
- Target release:
- Related docs:
  - SYSTEM_OVERVIEW.md
  - INVARIANTS.md
  - API.md
  - (Existing) Request Templates: `lib/templates-store.ts`, `app/api/request-templates/**`
  - (Existing) Environment templates: `config/environment-templates.ts`, `app/api/environment-templates/route.ts`

## Problem
Environment templates are currently static (`config/environment-templates.ts`) and lack:
- S3-backed storage
- Admin CRUD
- Parity with Request Templates model (index + docs, enabled flag, versioning metadata)

This blocks:
- Admin-managed template evolution
- Catalogue + create-environment flow parity (UI will come later)

## Goals
- S3-backed environment templates using index + per-template docs (S3 **single source of truth**)
- Admin CRUD endpoints (minimal backend first)
- Public list/detail endpoints for future catalogue usage
- Bootstrap via seed; S3 authoritative. No fallback to static config.

## Non-Goals (explicit)
- No UI / catalogue work in this delta
- No changes to Deploy flow or deployed detection
- No Terraform execution in-app
- No Postgres canonicalization (optional projection only if explicitly added later)

## Invariants (must not break)
- S3 request doc canonical (unchanged)
- Terraform runs only in GitHub Actions
- Model 2 env root structure unchanged
- Deployed detection via exact `backend.tf` existence (unchanged)
- Fail-closed on GitHub errors (unchanged)
- Lifecycle derived from facts only (unchanged)

### Seed invariant
- `POST /api/environment-templates/admin/seed` is **idempotent**: if `environment-templates/index.json` already exists → 409 `ENV_TEMPLATES_ALREADY_INITIALIZED`. Seed reads from `config/environment-templates.ts` (one-time bootstrap only), writes to S3; static config is then deprecated for runtime.
- **Write order:** Write template docs first (per-template objects), then index last. On partial failure (e.g. S3 error mid-seed), index is absent → retry succeeds (idempotent per doc; index written on success). Writing index first would leave partial state visible to readers on failure.

## Proposed Data Model

### S3 Storage Layout
- Bucket: `TFPILOT_TEMPLATES_BUCKET` (same as request templates; see `lib/config/env.ts`, `lib/templates-store.ts`)
- **Symmetric prefixes** (per-bucket layout):
  - `request-templates/index.json`, `request-templates/<id>.json` — request templates
  - `environment-templates/index.json`, `environment-templates/<id>.json` — env templates
- Env template prefix: `environment-templates/`

**Prerequisite:** Request templates currently use `templates/`; update to `request-templates/` (single change: `lib/templates-store.ts` PREFIX). Reseed request templates. No migration step — DB clean, templates can be reseeded.

**Implementation note — request-template S3 paths:** `lib/templates-store.ts` is the **only** place that defines S3 keys. Seed route (`app/api/request-templates/admin/seed/route.ts`), admin CRUD, and delete route all call `getTemplate`, `createTemplateWithId`, `deleteTemplate`, etc. — no hardcoded `templates/` or S3 paths elsewhere. Updating PREFIX (and JSDoc at line 114: `request-templates/index.json`) completes the switch.

### Index Document: `environment-templates/index.json`
- **Format:** Bare array (parity with request-templates; `lib/templates-store.ts` — `getTemplatesIndex` returns `TemplateIndexEntry[]`). `NoSuchKey` → return `[]` (same as request-templates).
- Shape: Array of `{ id, label, enabled, updatedAt, version? }`

### Template Document: `environment-templates/<id>.json`
- Shape: Align with current `config/environment-templates.ts` `EnvironmentTemplate` + S3 metadata:
  - `id`, `label?`, `description?`
  - `modules[]`: `{ module: string, order: number, defaultConfig?: Record<string, unknown> }` (matches static config)
  - `enabled` (default true)
  - `createdAt`, `updatedAt` (server-controlled ISO strings)
  - `version` (integer monotonic; parity with request templates)

### Validation Rules
- `id`: allowed charset (e.g. `a-z0-9-`), max length, immutability after create
- `label`: required, max length
- `modules[]`: each `module` **must** match `ModuleRegistryEntry.type` (source of truth: `config/module-registry.ts`). Validate via `moduleRegistry.find((m) => m.type === mod.module)`. Same key used in requests (`body.module`). See `lib/environments/envSkeleton.ts`, `app/api/requests/route.ts`, `npm run validate:registry`
- `defaultConfig`: reject unknown fields — **normative source:** `ModuleRegistryEntry.fields` for the referenced module; only keys present in `regEntry.fields` are allowed. Enforce size limit (e.g. max N keys, max value size). Templates feed into `envSkeleton` server-side.
- `enabled`: default true
- `version`: integer monotonic (parity with request templates; see `lib/templates-store.ts` lines 157–158, 261–262)
- Timestamps: server-controlled

## API Surface

### Admin API (CRUD)
- Base: `/api/environment-templates/admin`
- Route handlers: `app/api/environment-templates/admin/route.ts`, `app/api/environment-templates/admin/[id]/route.ts`, `app/api/environment-templates/admin/[id]/delete/route.ts`, `app/api/environment-templates/admin/seed/route.ts`
- Mirror request-templates structure:
  - `GET /api/environment-templates/admin` — list (index entries, includes disabled); handler: `admin/route.ts`
  - `POST /api/environment-templates/admin` — create (server assigns id/timestamps/version)
  - `GET /api/environment-templates/admin/[id]` — detail (full doc, any enabled state)
  - `PUT /api/environment-templates/admin/[id]` — replace (full update)
  - `PATCH /api/environment-templates/admin/[id]` — partial update (enable/disable, label tweaks)
  - `DELETE /api/environment-templates/admin/[id]` — soft disable (parity: request-templates DELETE = disable)
  - `POST /api/environment-templates/admin/[id]/delete` — hard delete (remove from index + delete object)

### Public API (create-environment flow + future catalogue)
- Base: `/api/environment-templates`
- Current handler: `app/api/environment-templates/route.ts` (GET only)
- Endpoints:
  - `GET /api/environment-templates` — list enabled only; **requires session** (401 if not authenticated; see current route)
  - `GET /api/environment-templates/[id]` — detail enabled only; 404 when disabled or missing (parity: `app/api/request-templates/[id]/route.ts`)

**Current GET response shape:** Raw array `{ id, label?, modules: { module, order, defaultConfig? }[] }[]`. 401: `{ error: "Not authenticated" }`. 500: `{ error: "Failed to load environment templates" }`.

### AuthZ / Access Control
- Admin gating: `requireAdminByEmail()` from `lib/auth/admin.ts` — checks `session.email` against `env.TFPILOT_ADMIN_EMAILS`; non-admin → 404 `{ error: "Not found" }` (same as request-templates)
- Public: session required (same as current `GET /api/environment-templates`). Catalogue later may introduce unauth list; out of scope.

## Error Semantics (consistent + explicit)

Align with existing API conventions (`app/api/request-templates/**`, `docs/API.md`):

| Code | HTTP | Response body | When |
|------|------|---------------|------|
| (generic) | 401 | `{ error: "Not authenticated" }` | No session |
| (generic) | 404 | `{ error: "Not found" }` | Admin gate non-admin; NoSuchKey; disabled template in public GET |
| `ENV_TEMPLATE_NOT_FOUND` | 404 | `{ error: "ENV_TEMPLATE_NOT_FOUND" }` | Optional: use for explicit “template missing” (otherwise `"Not found"`) |
| `ENV_TEMPLATE_DISABLED` | 404 | `{ error: "Not found" }` | **Chosen:** Public GET `/:id` when template exists but disabled — same as request-templates (404, no special code) |
| `ENV_TEMPLATE_ID_CONFLICT` | 409 | `{ error: "ENV_TEMPLATE_ID_CONFLICT" }` | Create with existing id (if client-supplied id allowed) |
| `ENV_TEMPLATE_VALIDATION_FAILED` | 400 | `{ error: "ENV_TEMPLATE_VALIDATION_FAILED", detail?: string }` | Invalid modules[], label, id format |
| `ENV_TEMPLATES_ALREADY_INITIALIZED` | 409 | `{ error: "ENV_TEMPLATES_ALREADY_INITIALIZED" }` | Seed when index already exists (idempotent guard; see Seed invariant) |
| (storage) | **500** | `{ error: "Failed to load environment templates" }` | S3 unreachable or unexpected; fail-closed. **Convention:** Use **500** for all storage/load errors in env-templates routes (parity with request-templates; avoids client/UI branching on 503 vs 500). |

**Convention:** Request-templates use `{ error: "Not found" }` for 404; `{ error: err.message }` for 400; **500** for S3/load failures. Env-templates **must** use the same status codes; keep `error` as string; optional `detail` for validation.

## Consistency + Concurrency

### Index write concurrency
Index is a single JSON object in S3; concurrent admin updates can clobber changes. **Chosen rule:** **Admin ops are low-frequency; accept last-write-wins.** Document this in the store layer. Future options if needed: conditional writes (ETag / `If-Match`) with retry on `PreconditionFailed`; or per-template-only writes + periodic reconcile job to rebuild index.

### Error/status consistency
All env-templates routes use **500** (not 503) for storage/load failures — parity with request-templates. No client branching.

### NoSuchKey semantics (S3 single source of truth)
- **Index missing** (`environment-templates/index.json` NoSuchKey): `GET /api/environment-templates` → `[]`; `GET /api/environment-templates/:id` → 404.
- **Index exists but empty** `[]`: same — list returns `[]`, detail returns 404 for any id.
- **No fallback** to static config anywhere.

### Template resolution (server-side, security)
Unlike request templates (which users pick client-side), env templates are **resolved server-side** and feed directly into `envSkeleton` → generated Terraform. Therefore: **validation must be strict** — reject unknown fields, enforce size limits on `defaultConfig`, and forbid injection paths. See Security Considerations.

### Module identity source of truth
**Rule:** `ModuleRegistryEntry.type` is the single identity key. Both `modules[].module` (env templates) and `request.module` (requests) must match it. No `module_key` or alias; validate via `moduleRegistry.find((m) => m.type === mod.module)`.

## Migration Plan (Static → S3)

**S3 single source of truth.** No fallback to static config.

- **Public `GET /api/environment-templates`:** Read from S3 only. Index missing → `[]`. Index empty → `[]`.
- **`GET /api/environment-templates/[id]`:** Read from S3 only. Doc or index missing → 404.
- **Admin CRUD:** S3 only.
- **Seed:** `POST /api/environment-templates/admin/seed` — one-time bootstrap. Reads from `config/environment-templates.ts`, writes to `environment-templates/`. **Invariant:** idempotent — if index already exists, return 409 `ENV_TEMPLATES_ALREADY_INITIALIZED`. After seed runs, static config is deprecated (used only as bootstrap source; never read at runtime).

**Consumers to update (later delta):**
- `lib/environments/validateTemplateId.ts` — switch from config to S3-backed resolver (valid ids = S3 index).
- `lib/environments/envSkeleton.ts` — switch from `environmentTemplates.find()` to S3 resolver.

**Rollback:** Restore previous S3 objects (index + template docs) or redeploy previous app version. **No static fallback** — rollback is data/version restore, not config switch.

## Observability
- Log events on admin operations (parity with request-templates `console.error` pattern in `app/api/request-templates/**`):
  - `[env-templates/admin] GET error`, `POST error`, etc.
  - `env_templates.list`, `env_templates.get`, `env_templates.create`, `env_templates.update`, `env_templates.delete`
- Log S3 path + correlationId (no secrets)
- Metrics (optional, minimal): count ops, failures by code

## Security Considerations
- **Template resolution is server-side:** Env templates drive `envSkeleton` generation; unlike request templates (client-picked), any stored template can affect Terraform output. **Require strict validation:** reject unknown top-level fields, validate `defaultConfig` keys against module registry `fields`, reject oversized `defaultConfig` (size limits), and forbid injection (e.g. no arbitrary strings into paths).
- Strict JSON schema validation
- Size limits for template docs / modules list

## Testing Strategy (minimal backend)
- Unit tests:
  - validation rules
  - index read/write behavior
- Integration tests (happy paths):
  - create → list → get → patch → delete
- Fail cases:
  - missing index
  - invalid module keys
  - disabled template visibility in public endpoints

## Rollout Plan
- **Step 0 (prerequisite):** Update `lib/templates-store.ts` — change PREFIX from `templates/` to `request-templates/`; reseed request templates.
- **Step 1:** Add `lib/env-templates-store.ts` (or `lib/templates-store-env.ts`) — `getEnvTemplatesIndex`, `getEnvTemplate`, `createEnvTemplate`, etc. Mirror `lib/templates-store.ts` with prefix `environment-templates/`.
- **Step 2:** Add admin CRUD routes behind `requireAdminByEmail()`; admin seed route (with 409 when index exists).
- **Step 3:** Run seed in ops (`POST /api/environment-templates/admin/seed`) — bootstrap `environment-templates/` from `config/environment-templates.ts`.
- **Step 4:** Update public endpoints — `GET /api/environment-templates`, `GET /api/environment-templates/[id]` — to read from S3 only.
- **Step 5 (later delta):** Update `validateTemplateId` and `envSkeleton` to resolve from S3; deprecate static config imports.

## Open Questions (resolved for this delta)

| Question | Decision |
|----------|----------|
| Version semantics | **Integer monotonic** — parity with request-templates (`lib/templates-store.ts`); 1 on create, increment on update. |
| Delete semantics | **Match request-templates:** `DELETE` = soft disable (`enabled: false`); `POST .../delete` = hard delete (remove from index + delete object). See `app/api/request-templates/admin/[id]/route.ts` (DELETE → `disableTemplate`) and `admin/[id]/delete/route.ts` (POST → `deleteTemplate`). |
| Public disabled behavior | **404** — public GET `/:id` returns 404 when template disabled; same as request-templates `app/api/request-templates/[id]/route.ts`. |
| modules[] shape | **Keys + order + optional defaultConfig** — match current `config/environment-templates.ts`: `{ module: string, order: number, defaultConfig?: Record<string, unknown> }`. |
| Index format | **Bare array** — parity with request-templates (`getTemplatesIndex` returns `TemplateIndexEntry[]`). |

## Appendix

### Example index (array format, parity with request-templates)
```json
[
  { "id": "blank", "label": "Blank", "enabled": true, "updatedAt": "2026-03-01T00:00:00Z", "version": 1 },
  { "id": "baseline-ai-service", "label": "Baseline AI Service", "enabled": true, "updatedAt": "2026-03-01T00:00:00Z", "version": 1 }
]
```

### Example template doc
```json
{
  "id": "baseline-ai-service",
  "label": "Baseline AI Service",
  "description": null,
  "modules": [
    { "module": "ecr-repo", "order": 1 },
    { "module": "cloudwatch-log-group", "order": 2 },
    { "module": "iam-role", "order": 3 },
    { "module": "s3-bucket", "order": 4 }
  ],
  "enabled": true,
  "createdAt": "2026-03-01T00:00:00Z",
  "updatedAt": "2026-03-01T00:00:00Z",
  "version": 1
}
```