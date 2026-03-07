# Architecture Delta: Environment Templates UI (Catalogue + Create Environment UX)

## Status
- Owner:
- Date:
- Target release:
- Related:
  - docs/plans-and-deltas/ARCHITECTURE_DELTA_ENV_TEMPLATES_PARITY.md
  - docs/plans-and-deltas/ARCHITECTURE_DELTA_ENV_TEMPLATES_S3_RESOLUTION.md
  - docs/API.md
  - docs/INVARIANTS.md

## Problem
Environment templates are now:
- S3-backed (admin CRUD + public read)
- Used by create-environment + deploy (template_id drives envSkeleton)

But there is no user-facing UI to:
- browse env templates (catalogue)
- pick a template during create environment
- understand what a template will provision (modules list)

## Goals
- Add an Environment Templates catalogue UI (read-only)
- Integrate template selection into Create Environment UX
- Preserve invariants + existing env lifecycle semantics
- Keep changes incremental and reversible (UI-only risk)

## Non-Goals
- No Terraform execution in app
- No changes to deploy detection, PR flow, backend.tf rule
- No Postgres canonical changes
- No admin CRUD UI for env templates in this delta (optional follow-up)

## Invariants (must not break)
- Terraform only runs in GitHub Actions
- Model 2 env roots unchanged
- S3 request docs canonical; Postgres projection only
- Lifecycle derived from facts only
- Deployed detection via exact backend.tf existence

---

## 1. Current State (Extracted from Repo)

### 1.1 Existing Catalogue Routes and Components

| Path | Purpose | API Used | Notes |
|------|---------|----------|-------|
| `app/catalogue/page.tsx` | Request templates list | `GET /api/request-templates`, `GET /api/request-templates/admin` | Admin: seed, create, edit, disable/enable, delete. Search by label/module/project/environment |
| `app/catalogue/[id]/page.tsx` | Request template detail/editor | `GET /api/request-templates/[id]`, `POST`/`PUT` admin | Schema: project, environment, module, defaultConfig. CTA: "Create request" → `/requests/new?templateId=${id}` |

**Note:** All catalogue pages are for **request templates** only. There is no environment templates catalogue. Nav: `app/nav-bar.tsx` links "Catalogue" → `/catalogue`.

**Catalogue structure decision:** Request and environment templates will live on the **same catalogue page** (`/catalogue`) in **separate sections**, with clear headers and distinct CTAs. Single "Catalogue" destination; no sub-routes for the list view.

### 1.2 Existing "Create Environment" UX

| Location | Behavior | template_id |
|----------|----------|-------------|
| `app/environments/page.tsx` | List only: table, project filter, include archived. No create form, no create button | N/A |
| `app/environments/[id]/page.tsx` | Detail: deploy, destroy, drift, activity. No create | N/A |

**Create Environment form/route:** Does **not** exist in the UI. `POST /api/environments` is implemented and used by tests; no page calls it. The delta will add the Create Environment flow.

### 1.3 Current API Response Shapes

#### GET /api/environment-templates

- **200:** Raw array of full template docs (no wrapper object)
- **401:** `{ error: "Not authenticated" }`
- **500:** `{ error: "Failed to load environment templates" }`

**Template doc shape (from `lib/env-templates-store.ts`):**

```ts
{
  id: string
  label?: string
  description?: string
  modules: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  version?: number
}
```

**Fields used by UI:** `id`, `label`, `description`, `modules` (for count/summary and detail table).

#### GET /api/environment-templates/[id]

- **200:** Single template doc (same shape as above)
- **401:** `{ error: "Not authenticated" }`
- **404:** `{ error: "Not found" }` (disabled or missing)
- **500:** `{ error: "Failed to load template" }`

#### POST /api/environments

**Request body:**
```ts
{
  project_key: string
  environment_key: string
  environment_slug: string
  template_id?: string | null
}
```

**201:** `{ environment: EnvRow, bootstrap: BootstrapResult }` where:
- `environment`: `{ environment_id, project_key, repo_full_name, environment_key, environment_slug, archived_at, created_at, updated_at }`
- `bootstrap`: either `{ already_bootstrapped: true }` or `{ pr_number, pr_url, branch_name, commit_sha }`

**401:** `{ error: "Not authenticated" }`  
**403:** `{ error: "Insufficient role" }` (viewer)  
**400:** `{ error: "INVALID_ENV_TEMPLATE" }` (template disabled/missing)  
**503:** `{ error: "ENV_TEMPLATES_NOT_INITIALIZED" }` (index not seeded)  
**400:** `{ error: "Validation failed", errors }` (body validation)  
**500:** storage/unexpected errors

### 1.4 Current Auth Handling in UI (Session-Required Flows)

| Flow | Pattern | UX |
|------|---------|-----|
| Catalogue (request templates) | Fetch `/api/request-templates` → if 401, set `notFound` | Render full-page message: "Sign in to browse templates" + `<Link href="/login">Sign in</Link>` |
| Environments list | Fetch `/api/environments` → `res.ok ? data : { environments: [] }` | Does not explicitly handle 401; fails silently to empty list |

**Reference:** `app/catalogue/page.tsx` lines 64–66 (admin 404 → try public), 65–67 (public 401 → setNotFound), 226–235 (notFound UI).

---

## 2. Delta: Exact Paths and Changes

### Phase 1: Environment Templates Catalogue (Read-Only)

Unified catalogue: **one page** (`/catalogue`) with **two sections**—Request Templates and Environment Templates.

| Action | Path | Notes |
|--------|------|-------|
| **Change** | `app/catalogue/page.tsx` | Add "Environment Templates" section below (or above) existing Request Templates. Fetch `GET /api/environment-templates` — **response is a raw array** (no wrapper); do not expect `{ templates: [...] }` or wrap. Render cards/tiles. Section header + short description. **Each section has its own search input** (avoids surprising cross-section filtering). Empty states: see §4.1. Request template cards → `/catalogue/[id]`; env template cards → `/catalogue/environments/[id]` |
| **Add** | `app/catalogue/environments/[id]/page.tsx` | Detail page: fetch `GET /api/environment-templates/[id]`. Modules table (order, module, defaultConfig preview). CTA: "Use this template" → `/environments/new?template_id=${id}` |
| No change | `app/nav-bar.tsx` | "Catalogue" → `/catalogue` (unchanged; single destination) |

### Phase 2: Create Environment UX Integration

| Action | Path | Notes |
|--------|------|-------|
| **Add** | `app/environments/new/page.tsx` | Create form. Step 1: Choose template (Blank first, then API list). Read preselection from `?template_id=...` (canonical; matches API field). Step 2: project_key, environment_key, environment_slug. Step 3: Submit → `POST /api/environments` |
| **Change** | `app/environments/page.tsx` | Add "Create environment" button → `/environments/new` |

---

## 3. API Response Shapes (Reference)

### Templates Array (GET /api/environment-templates)

Response is the array itself, not `{ templates: [...] }`:

```json
[
  {
    "id": "fullstack",
    "label": "Full Stack",
    "description": "Web + DB",
    "modules": [
      { "module": "ecs", "order": 1, "defaultConfig": {} },
      { "module": "postgres", "order": 2 }
    ],
    "enabled": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "version": 1
  }
]
```

### POST /api/environments Success (201)

```json
{
  "environment": {
    "environment_id": "uuid",
    "project_key": "myproject",
    "repo_full_name": "org/repo",
    "environment_key": "dev",
    "environment_slug": "my-env",
    "archived_at": null,
    "created_at": "...",
    "updated_at": "..."
  },
  "bootstrap": {
    "pr_number": 42,
    "pr_url": "https://github.com/...",
    "branch_name": "env/myproject/dev/my-env",
    "commit_sha": "..."
  }
}
```

Or when already bootstrapped: `"bootstrap": { "already_bootstrapped": true }`.

---

## 4. Error Handling UX (Exact)

| Code | HTTP | Response Body | UI Behavior |
|------|------|---------------|--------------|
| Not authenticated | 401 | `{ error: "Not authenticated" }` | Full-page: "Sign in to create environments" (or "Sign in to browse templates" for catalogue). `<Link href="/login">Sign in</Link>`. Same pattern as `app/catalogue/page.tsx`. |
| Templates not initialized | 503 | `{ error: "ENV_TEMPLATES_NOT_INITIALIZED" }` | Inline error on create form (or catalogue empty/error state): "Environment templates are not initialized. Ask an admin to run the seed." No redirect. |
| Invalid template | 400 | `{ error: "INVALID_ENV_TEMPLATE" }` | Inline error on create form: "The selected template is not available (disabled or removed). Please choose another." Suggest re-fetching template list or picking Blank. |

**Catalogue-specific:**
- 401 on `GET /api/environment-templates` → full-page "Sign in to browse templates" (match request-templates).
- 500 → "Failed to load templates" with retry option.

### 4.1 Empty state wording (env templates list)

| Response | Meaning | UI message |
|----------|---------|-------------|
| **503** `ENV_TEMPLATES_NOT_INITIALIZED` | Index not seeded | "Environment templates are not initialized. Ask an admin to run the seed." |
| **200** empty array `[]` | Initialized but no enabled templates | "No enabled templates." |

These are distinct; do not conflate. 503 = seed not run. 200 empty = seed run, all disabled or none defined.

---

## 5. Blank Template: UI-Only (Recommended)

**Decision:** "Blank" is **UI-only**; it is **not** included in the API list as a synthetic option.

- **Implementation:**
  - Catalogue list: Do **not** add a "Blank" card. Blank is only relevant in the create flow.
  - Create Environment form: Prepend a single "Blank" option as the first choice in the template selector. When selected, send `template_id: null` or omit `template_id`.
  - API `GET /api/environment-templates` returns only S3-stored templates; if seed includes a "blank" template, it may appear — but the UI should still prepend its own "Blank" as first option for consistency (no API dependency).

- **Rationale:** Keeps API semantics simple; Blank = one less S3 doc to manage; UI always shows it regardless of seed state.

---

## 6. Implementation Order (Incremental)

1. **Catalogue first (read-only):**
   - Modify `app/catalogue/page.tsx` to add Environment Templates section (same page, separate section with header)
   - Add `app/catalogue/environments/[id]/page.tsx` for env template detail
   - Handle 401 (full-page sign-in), 500 (retry) for env templates fetch

2. **Create Environment second:**
   - Add `app/environments/new/page.tsx` with template picker (Blank first) + project/env fields
   - Add "Create environment" CTA on `app/environments/page.tsx`
   - Handle 401, 503, 400 as above
   - On success: redirect to `/environments/[id]`

---

## 7. Observability (Optional)

- `env_templates.ui_list_loaded`
- `env_templates.ui_selected_template`
- `environments.ui_create_submitted`
- `environments.ui_create_failed` (with `code`)

---

## 8. Testing

- Minimal: Playwright (or existing e2e) happy path: browse catalogue → select template → create environment → land on env detail
- Component tests optional

---

## 9. Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Where should catalogue live? | **Unified page.** Request and environment templates on the same `/catalogue` page in separate sections. Env template detail at `/catalogue/environments/[id]`. |
| List endpoint: full docs vs index+detail? | **Full docs.** `GET /api/environment-templates` already returns full objects. Use as-is. |
| Blank in API list or UI-only? | **UI-only.** Prepend "Blank" in create form; omit `template_id` when selected. |
| Create flow query param for preselection? | **`template_id`.** Use `?template_id=${id}` (matches API field; avoids mapping bugs). Never `templateId`. |
