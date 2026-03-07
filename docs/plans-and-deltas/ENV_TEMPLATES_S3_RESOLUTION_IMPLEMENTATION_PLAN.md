# Env Templates S3 Resolution — Implementation Plan (Step 7)

**Authoritative:** `docs/plans-and-deltas/ARCHITECTURE_DELTA_ENV_TEMPLATES_S3_RESOLUTION.md`

> Create-environment and deploy resolve env templates from S3 (authoritative). "blank" is a built-in virtual template; non-blank requires S3 index.

---

## Overview

### Scope of change
- Replace static config usage in `validateTemplateId` and `envSkeleton` with S3-backed resolution
- Add `validateTemplateIdOrThrow` (async); deprecate `isValidTemplateId`
- POST /api/environments and deploy route: map template errors to 400/503
- Blank env always allowed (built-in virtual template); non-blank requires S3 index

### Invariants that must not break
- Terraform runs only in GitHub Actions
- Model 2 env roots unchanged (`envs/<key>/<slug>/`, `tfpilot/requests/`)
- Deployed detection via exact `backend.tf` on default branch
- S3 request docs canonical; Postgres projection only
- No parsing Terraform files

### Constraints
- No UI changes
- No fallback to static config
- Preserve Model 2 filesystem layout

---

## Step 1 — validateTemplateIdOrThrow

Implement async resolver using env-templates store. Allow null/undefined/"blank". Non-blank requires index. Throw `ENV_TEMPLATES_NOT_INITIALIZED` or `INVALID_ENV_TEMPLATE`.

### Files changed
| File | Change |
|------|--------|
| `lib/environments/validateTemplateId.ts` | Add `validateTemplateIdOrThrow(template_id): Promise<void>`; define and export `INVALID_ENV_TEMPLATE`, `ENV_TEMPLATES_NOT_INITIALIZED`; keep `isValidTemplateId` for now or remove after Step 2–3 |

**Constant ownership:** Define and export `INVALID_ENV_TEMPLATE` and `ENV_TEMPLATES_NOT_INITIALIZED` from `lib/environments/validateTemplateId.ts` (or a small `lib/environments/templateErrors.ts`). Do **not** add these to `lib/env-templates-store.ts` — the store is a storage primitive; keep HTTP-ish error codes in the environments domain to avoid "store knows about API codes" drift.

### Implementation notes
- **Blank pass-through:** If `template_id === null` or `undefined` or `(typeof template_id === "string" && template_id.trim() === "blank")` → return immediately (no S3).
- **Empty string:** Throw with `code: "INVALID_ENV_TEMPLATE"`.
- **Non-blank:** Call `envTemplatesIndexExists()`. If false → throw `ENV_TEMPLATES_NOT_INITIALIZED`. If true → fetch `getEnvTemplatesIndex()`, filter `enabled`, check id in set. If missing or disabled → throw `INVALID_ENV_TEMPLATE`.
- Error shape: `Error` with `err.code` = `"ENV_TEMPLATES_NOT_INITIALIZED"` or `"INVALID_ENV_TEMPLATE"`.
- Non-NoSuchKey S3 errors from store → let propagate (caller maps to 500).

### Acceptance checks
| Scenario | Expected |
|----------|----------|
| `validateTemplateIdOrThrow(null)` | Resolves (no throw) |
| `validateTemplateIdOrThrow(undefined)` | Resolves (no throw) |
| `validateTemplateIdOrThrow("blank")` | Resolves (no throw), even when index missing |
| `validateTemplateIdOrThrow("")` | Throws `INVALID_ENV_TEMPLATE` |
| `validateTemplateIdOrThrow("unknown")` when index present | Throws `INVALID_ENV_TEMPLATE` |
| `validateTemplateIdOrThrow("baseline-ai-service")` when index missing | Throws `ENV_TEMPLATES_NOT_INITIALIZED` |
| `validateTemplateIdOrThrow("baseline-ai-service")` when index present + enabled | Resolves (no throw) |
| `validateTemplateIdOrThrow("baseline-ai-service")` when index present + disabled | Throws `INVALID_ENV_TEMPLATE` |

### Cursor prompt

```
Implement validateTemplateIdOrThrow in lib/environments/validateTemplateId.ts.

API: validateTemplateIdOrThrow(template_id: string | null | undefined): Promise<void>

Logic:
- null, undefined, or "blank" (trimmed) → return (no S3 lookup)
- empty string or whitespace-only → throw Error with code "INVALID_ENV_TEMPLATE"
- non-blank: call envTemplatesIndexExists() from @/lib/env-templates-store. If false → throw with code "ENV_TEMPLATES_NOT_INITIALIZED"
- non-blank + index exists: getEnvTemplatesIndex(), filter enabled, check id in enabled set. If not found or disabled → throw "INVALID_ENV_TEMPLATE"

Define and export constants in this file: INVALID_ENV_TEMPLATE, ENV_TEMPLATES_NOT_INITIALIZED. Do not add them to lib/env-templates-store.ts.

Add unit tests in tests/unit/validateTemplateIdOrThrow.test.ts or extend env templates tests. Use __testOnlySetS3 to stub S3 for deterministic tests.
```

---

## Step 2 — POST /api/environments

Replace `isValidTemplateId` with `validateTemplateIdOrThrow`. Map errors to 400 or 503.

### Files changed
| File | Change |
|------|--------|
| `app/api/environments/route.ts` | Replace `isValidTemplateId(body.template_id)` with `await validateTemplateIdOrThrow(body.template_id)`; catch and map `INVALID_ENV_TEMPLATE` → 400, `ENV_TEMPLATES_NOT_INITIALIZED` → 503 |
| `tests/invariants/environmentsCreate.test.ts` | Update if it imports `isValidTemplateId`; switch to `validateTemplateIdOrThrow` or keep sync tests for `isValidTemplateId` if retained |

### Implementation notes
- Wrap call in try/catch. Read `err.code`. Map:
  - `INVALID_ENV_TEMPLATE` → `400 { error: "INVALID_ENV_TEMPLATE" }`
  - `ENV_TEMPLATES_NOT_INITIALIZED` → `503 { error: "ENV_TEMPLATES_NOT_INITIALIZED" }`
  - Other → rethrow (e.g. 500 from S3)
- Normalize `template_id`: null/undefined → store as `null`; `"blank"` or empty after trim → store as `null` or `"blank"` per current behavior (trimmed string if non-empty, else null).

### Acceptance checks
| Scenario | Expected |
|----------|----------|
| POST with `template_id: null` when index missing | 201 (blank env succeeds) |
| POST with `template_id: "blank"` when index missing | 201 |
| POST with `template_id: "baseline-ai-service"` when index missing | 503 `{ error: "ENV_TEMPLATES_NOT_INITIALIZED" }` |
| POST with `template_id: "unknown"` when index present | 400 `{ error: "INVALID_ENV_TEMPLATE" }` |
| POST with `template_id: "baseline-ai-service"` when index present + enabled | 201 |

### Cursor prompt

```
Update app/api/environments/route.ts:

1. Replace: if (!isValidTemplateId(body.template_id)) { return 400 INVALID_ENV_TEMPLATE }
   With: try { await validateTemplateIdOrThrow(body.template_id) } catch (e) { 
     if (e.code === "INVALID_ENV_TEMPLATE") return 400
     if (e.code === "ENV_TEMPLATES_NOT_INITIALIZED") return 503
     throw e 
   }

2. Import validateTemplateIdOrThrow, INVALID_ENV_TEMPLATE, ENV_TEMPLATES_NOT_INITIALIZED from @/lib/environments/validateTemplateId.
3. Ensure template_id normalization is unchanged (null/blank → null for DB; non-blank trimmed string).
```

---

## Step 3 — Deploy route

Same change as Step 2: replace `isValidTemplateId` with `validateTemplateIdOrThrow`; map errors to 400 or 503.

### Files changed
| File | Change |
|------|--------|
| `app/api/environments/[id]/deploy/route.ts` | Replace `isValidTemplateId(template_id)` with `await validateTemplateIdOrThrow(template_id)`; catch and map errors |
| `tests/invariants/deployErrors.test.ts` | Update if it uses `isValidTemplateId`; adjust for async validation |

### Implementation notes
- `template_id = envRow.template_id ?? "blank"` (unchanged).
- Same try/catch mapping: `INVALID_ENV_TEMPLATE` → 400, `ENV_TEMPLATES_NOT_INITIALIZED` → 503.
- Deploy route uses `makePOST` with deps; ensure no sync validation before envSkeleton.

### Acceptance checks
| Scenario | Expected |
|----------|----------|
| Deploy env with template_id null when index missing | 201 (blank skeleton) |
| Deploy env with template_id "baseline-ai-service" when index missing | 503 `ENV_TEMPLATES_NOT_INITIALIZED` |
| Deploy env with template_id "baseline-ai-service" when index present + enabled | 201 |
| Deploy env with template_id "unknown" when index present | 400 `INVALID_ENV_TEMPLATE` |

### Cursor prompt

```
Update app/api/environments/[id]/deploy/route.ts:

1. Replace isValidTemplateId(template_id) check with:
   try { await validateTemplateIdOrThrow(template_id) } catch (e) {
     if (e.code === "INVALID_ENV_TEMPLATE") return NextResponse.json({ error: "INVALID_ENV_TEMPLATE" }, { status: 400 })
     if (e.code === "ENV_TEMPLATES_NOT_INITIALIZED") return NextResponse.json({ error: "ENV_TEMPLATES_NOT_INITIALIZED" }, { status: 503 })
     throw e
   }

2. Remove isValidTemplateId import; add validateTemplateIdOrThrow.
```

---

## Step 4 — envSkeleton S3 resolver

Blank → built-in modules:[]; non-blank → load S3 template; generate skeleton using template.modules.

### Files changed
| File | Change |
|------|--------|
| `lib/environments/envSkeleton.ts` | Make async; for "blank" use built-in `{ modules: [] }`; for non-blank call `getEnvTemplate(id)` from env-templates-store; use template.modules for skeleton generation |
| `app/api/environments/[id]/deploy/route.ts` | Await `envSkeleton(...)` (now async) |
| `tests/unit/envSkeleton.test.ts` | Use S3 stub; update for async; add tests for blank (no S3) and non-blank (S3 doc) |

### Implementation notes
- **Assume validation already ran:** `validateTemplateIdOrThrow` runs before envSkeleton in both create and deploy flows. envSkeleton does **not** re-check the index; that avoids extra S3 calls and keeps envSkeleton focused.
- **Signature:** `envSkeleton(params): Promise<EnvSkeletonResult>` (async).
- **Blank:** If `template_id === "blank"` (after normalize) → return skeleton with `modules: []`; no S3. Produce: `backend.tf`, `providers.tf`, `versions.tf`, `tfpilot/base.tf`, `tfpilot/requests/.gitkeep` only.
- **Non-blank:** Call `getEnvTemplate(id)`. If doc missing (NoSuchKey) → throw `INVALID_ENV_TEMPLATE`. Non-NoSuchKey S3 errors → propagate (500).
- **Module resolution:** Same as today: `moduleRegistry.find(m => m.type === mod.module)`, `generateModel2RequestFile`, etc. Use `template.modules` from S3 doc.
- **Normalization:** Deploy passes `template_id ?? "blank"`. EnvSkeleton receives `"blank"` or non-blank string.

### Acceptance checks
| Scenario | Expected |
|----------|----------|
| `envSkeleton({ ..., template_id: "blank" })` | No S3 call; returns skeleton with base files only, no request .tf files |
| `envSkeleton({ ..., template_id: "baseline-ai-service" })` with S3 doc | Returns skeleton with module request files per doc |
| `envSkeleton` non-blank when doc missing | Throws (caller gets 400 or 500) |
| File layout | Unchanged: `envs/<key>/<slug>/backend.tf`, `providers.tf`, `versions.tf`, `tfpilot/base.tf`, `tfpilot/requests/*.tf` |

### Cursor prompt

```
Update lib/environments/envSkeleton.ts:

1. Change to async: envSkeleton(params): Promise<EnvSkeletonResult>
2. Assume validateTemplateIdOrThrow already ran (create + deploy route). Do NOT re-check index; no extra S3 calls.
3. Blank: if template_id is "blank" (or normalize null/undefined to "blank"), use built-in template { modules: [] }. No S3. Return skeleton with base files only.
4. Non-blank: await getEnvTemplate(id) from @/lib/env-templates-store. Use template.modules (sorted by order), resolve each module via moduleRegistry, generate request files via generateModel2RequestFile.
5. On getEnvTemplate NoSuchKey: throw Error with code "INVALID_ENV_TEMPLATE" (import constant from validateTemplateId). Non-NoSuchKey S3 errors → propagate.
6. Deploy route: await envSkeleton(...).

Update tests/unit/envSkeleton.test.ts: use __testOnlySetS3 for non-blank; blank test needs no stub. All tests await envSkeleton.
```

---

## Post-implementation

- Run `npm run test:invariants`; update `tests/invariants/environmentsCreate.test.ts` and `deployErrors.test.ts` if they assert on `isValidTemplateId`.
- Remove `isValidTemplateId` once all callers use `validateTemplateIdOrThrow` (or keep for backward compat if needed elsewhere).
- Ops: run seed before enabling; verify create-environment and deploy with non-blank template.
