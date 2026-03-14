# TfPilot Legacy & Dead Code Cleanup Audit

**Date:** 2026-03-14  
**Scope:** Full platform scan for legacy patterns, dead code, orphaned files, and cleanup candidates.  
**Context:** Platform is workspace-first; `/api/environments` and `lib/environments` were removed per DOCS_INDEX and CLEANUP_AUDIT_POST_TEMPLATE_ONLY. This audit verifies current state and lists actionable cleanup.

---

## 1. Executive summary

| Severity | Count | Description |
|----------|--------|--------------|
| **Critical** | 2 | Broken UX: New Request page and Catalogue redirect call removed APIs / non-existent routes. |
| **High** | 2 | Broken script import; nav/labels for removed concept; misplaced doc. |
| **Medium** | 4 | Deprecated aliases, stale doc references, legacy naming in lib. |
| **Low** | 3 | Optional renames and doc alignment. |

**Recommended order:** Fix critical (New Request + Catalogue) first so the app works; then remove/fix broken script and nav; then clean deprecated aliases and docs.

---

## 2. Critical: Broken / removed API still referenced by UI

### 2.1 New Request page — `/api/environments` and “environment” UX

**File:** `app/requests/new/page.tsx`

**Issue:** The page still implements an **environment-based** flow and calls APIs that **no longer exist**:

- `fetch(\`/api/environments?project_key=...\`)` — list environments by project
- `fetch(\`/api/environments/${selectedEnvironmentId}\`)` — get one environment / deploy status
- `fetch(\`/api/environments/${envId}\`)` — used for `?environmentId=` query prefill

There is **no** `app/api/environments/` route tree in the codebase (confirmed by glob of `app/api/**/route.ts`). Those requests will 404 or fail.

**Additional legacy surface:**

- State and UI talk in terms of “environments” (e.g. `apiEnvironments`, `selectedEnvironmentId`, “Select an Environment”).
- Copy and links point to `/environments` and “create one at /environments” (no such page).
- `DEFAULT_ENVIRONMENT_KEYS = ["dev", "prod"]` is used for fallback; canonical model is **workspaces**, not env keys.

**Recommendation:**

1. **Migrate New Request to workspace-first:**  
   - Project → **Workspace** (from `GET /api/workspaces` or project-scoped workspaces), then create request in that workspace.
2. Replace all `/api/environments*` calls with workspace APIs (e.g. `GET /api/workspaces`, `GET /api/workspaces/[id]` for deploy status).
3. Replace “environment” copy and links with “workspace” and e.g. `/projects/[id]/workspaces` or `/catalogue/workspaces`.
4. Use `lib/new-request-gate.ts` and workspace deploy status for gating “Create Request” (already workspace-oriented).

**Impact:** Without this, the New Request flow is broken for any user (empty env list, failed fetches, wrong links).

---

### 2.2 Catalogue redirect to non-existent route

**File:** `app/catalogue/page.tsx`

**Issue:** The catalogue index page does:

```ts
router.replace("/catalogue/environments")
```

There is **no** `app/catalogue/environments/` route. The app has:

- `app/catalogue/page.tsx`
- `app/catalogue/[id]/page.tsx`
- `app/catalogue/workspaces/page.tsx`, `app/catalogue/workspaces/[id]/page.tsx`
- `app/catalogue/requests/page.tsx`

So `/catalogue/environments` does not exist → redirect sends users to a 404.

**Recommendation:** Change redirect to workspace-based entry, e.g.:

- `router.replace("/catalogue/workspaces")`  
so catalogue lands on an existing page. Update any other references to “catalogue/environments” (e.g. links, docs) to “catalogue/workspaces”.

---

## 3. High: Broken script and legacy nav/labels

### 3.1 Script with broken import — `scripts/verify-isEnvironmentDeployed.ts`

**Issue:** The script imports:

```ts
import { isEnvironmentDeployed } from "@/lib/environments/isEnvironmentDeployed"
```

The directory **`lib/environments/` does not exist**. The codebase has `lib/workspaces/isWorkspaceDeployed.ts` (and related workspace deploy logic). So this script will fail at import/resolution.

**Recommendation (choose one):**

- **Option A (preferred):** Delete `scripts/verify-isEnvironmentDeployed.ts` if it’s no longer needed; the behavior is covered by workspace deploy checks and `lib/workspaces/isWorkspaceDeployed.ts`. Remove any references (e.g. in docs or package.json if it’s wired there).
- **Option B:** Rewrite the script to use `isWorkspaceDeployed` from `lib/workspaces/isWorkspaceDeployed.ts` and workspace-shaped inputs; rename to something like `verify-isWorkspaceDeployed.ts` and update docs.

**Note:** `npm run validate:legacy-env` is still valid and runs `scripts/validate-legacy-env.ts` (no dependency on `lib/environments`). Only the manual verify script is broken.

---

### 3.2 AppShell nav title for “Environments”

**File:** `components/layout/AppShell.tsx`

**Issue:** `getPageTitle(pathname)` returns `"Environments"` when `pathname.startsWith("/environments")`. There is no `/environments` route in the app (no `app/environments/` tree). So this is dead code and can mislead future readers.

**Recommendation:** Remove the `/environments` branch from `getPageTitle`, or replace it with a “Workspaces” branch for a workspace path if you add one. Prefer removing legacy path handling.

---

### 3.3 Misplaced / third-party doc at repo root

**File:** `org-and-project-settings.md` (project root)

**Issue:** Content is from **env0** (e.g. “docs.envzero.com”, “env zero”, “backend.api.env0.com”). It’s not TfPilot product docs and doesn’t belong at repo root.

**Recommendation:** Remove from root. Options: delete, or move to something like `docs/archive/org-and-project-settings-env0-reference.md` with a one-line header: “ARCHIVED — External env0 reference, not TfPilot.” Prefer delete unless you need it as an external reference.

---

## 4. Medium: Deprecated aliases and stale references

### 4.1 Deprecated “env” aliases in lib (still used)

**Files:**

- `lib/requests/requireEnvFields.ts` — exports `getMissingEnvFields`, `requireEnvFieldsForDestroy` (deprecated) and workspace-named implementations.
- `lib/requests/auditMissingEnv.ts` — exports `isMissingEnvField`, `getRequestIdsMissingEnv` (deprecated) and workspace-named implementations.

**Status:** Callers (destroy route, admin audit route, tests) still use the deprecated names. Behavior is correct; only naming is legacy.

**Recommendation:** In one pass: (1) switch all callers to the workspace-named exports; (2) remove the deprecated aliases; (3) optionally rename files to e.g. `requireWorkspaceFields.ts` / `auditMissingWorkspace.ts` and update imports. See CLEANUP_AUDIT_POST_TEMPLATE_ONLY §4.

---

### 4.2 Docs still referring to removed env API / old names

**Files to update (when touching those areas):**

- **docs/POSTGRES_INDEX.md** — If it still mentions `environment_key` / `environment_slug` in index schema or `listRequestIndexRowsByEnvironment`, update to `workspace_key` / `workspace_slug` and `listRequestIndexRowsByWorkspace`. Schema in code is already workspace-named.
- **docs/API.md** — Remove or update any mention of `GET /api/environments/:id/activity`; activity is served by workspace route `GET /api/workspaces/[id]/activity`.
- **docs/ORG_SUPPORT_FORENSIC_REPORT.md** — Replace references to `/api/environments/:id/activity` and `listRequestIndexRowsByEnvironment` with workspace API and `listRequestIndexRowsByWorkspace`.

**Note:** `lib/db/requestsList.ts` only exports `listRequestIndexRowsByWorkspace`; there is no `listRequestIndexRowsByEnvironment` alias in code. Only doc references need updating.

---

### 4.3 Run index and RUN_INDEX naming

**Files:** `lib/github/workspaceDestroyRunIndex.ts`, `lib/github/workspaceDriftRunIndex.ts`; **docs/RUN_INDEX.md**

**Issue:** RUN_INDEX.md and/or code may still use “Environment destroy/drift index” and paths like `env-destroy/`, `env-drift/`. Behavior is workspace-scoped.

**Recommendation:** When editing RUN_INDEX or those modules, align naming with “Workspace destroy/drift index” and workspace terminology. Low priority unless you’re refactoring that area.

---

### 4.4 Catalogue “[id]” page — static “environments” list

**File:** `app/catalogue/[id]/page.tsx`

**Issue:** Uses `const environments = DEFAULT_ENVIRONMENT_KEYS` (e.g. `["dev", "prod"]`) for a dropdown. This is a static list, not project/workspace-based. If this page is for request templates or similar, consider feeding it from workspace or project data instead of a hardcoded env list.

**Recommendation:** Treat as tech debt: when reworking catalogue or request-template UX, drive “environment”/workspace from API (e.g. workspaces for selected project) rather than `DEFAULT_ENVIRONMENT_KEYS`.

---

## 5. Low: Optional renames and consistency

### 5.1 Script names

- **`scripts/validate-legacy-env.ts`** — Still useful (guards against legacy env patterns in app/lib). Consider renaming to e.g. `validate-workspace-only-patterns.ts` and npm script to `validate:workspace-patterns` for consistency. Not urgent.
- **`scripts/verify-isEnvironmentDeployed.ts`** — See §3.1; fix or remove before renaming.

### 5.2 “env0” references in docs

**Files:** e.g. `docs/ROADMAP_2026.md`, `docs/plans-and-deltas/ARCHITECTURE_DELTA_TEMPLATE_ONLY_WORKSPACES.md`, `app/api/org/teams/access/route.ts`, `lib/db/projectRoles.ts`, `org-and-project-settings.md`, etc.

**Issue:** “env0” appears in comparisons (“comparable to env0”), design notes (“env0-style”), and the root-level doc that’s really env0 content.

**Recommendation:** Keep roadmap/comparison mentions as-is. Remove or relocate root-level env0 doc (§3.3). No need to rename “env0-style” in code comments unless you’re doing a broader wording pass.

---

## 6. What was verified as already clean

- **No `app/api/environments/`** — No route tree; no stray env route files.
- **No `lib/environments/`** — Directory removed; only `lib/workspaces/` exists for deploy/activity.
- **No `lib/db/environments.ts`** — Not present; workspace CRUD is in `lib/db/workspaces.ts`.
- **No `listRequestIndexRowsByEnvironment`** in `lib/db/requestsList.ts` — Only `listRequestIndexRowsByWorkspace` is exported.
- **`validate-legacy-env`** — Script and CI usage are valid; no dependency on removed code.
- **cost-service** — Used by request route and sync route; not dead.
- **templates-store vs workspace-templates-store** — Both exist and are used; `templates-store.ts` is request-templates (S3 `request-templates/`); `workspace-templates-store.ts` is workspace templates. No `env-templates-store` in codebase.

---

## 7. Suggested cleanup order

1. **Critical**
   - Migrate **New Request** to workspaces: replace `/api/environments` with workspace APIs, switch copy/links to workspaces.
   - Fix **Catalogue** redirect: `router.replace("/catalogue/workspaces")` (or desired entry URL).
2. **High**
   - Remove or rewrite **verify-isEnvironmentDeployed.ts** (fix broken import).
   - Remove **Environments** branch in **AppShell** `getPageTitle`.
   - Remove or archive **org-and-project-settings.md** at root.
3. **Medium**
   - Migrate callers from deprecated aliases in **requireEnvFields** / **auditMissingEnv**, then remove aliases (and optionally rename files).
   - Update **POSTGRES_INDEX.md**, **API.md**, **ORG_SUPPORT_FORENSIC_REPORT.md** for workspace naming and current routes.
4. **Low**
   - Optional script/doc renames and RUN_INDEX wording when touching those areas.

---

## 8. References

- **docs/DOCS_INDEX.md** — States API is workspace-first; `/api/environments` removed.
- **docs/plans-and-deltas/CLEANUP_AUDIT_POST_TEMPLATE_ONLY.md** — Legacy env removal and compatibility layer; some items from this audit are already done (e.g. no env route, no `listRequestIndexRowsByEnvironment`).
- **docs/SCREAMING_ARCHITECTURE.md** — Current app/lib layout and workspace vs request-templates.
- **docs/SYSTEM_OVERVIEW.md** — Workspace lifecycle, deploy detection, new-request gating.
