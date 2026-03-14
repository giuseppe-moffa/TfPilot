# Deep Cleanup Audit & Reset Plan — Post Template-Only Workspaces

**Historical delta / superseded.** This audit was written before the final surface cleanup. The deprecated `/api/environments` routes and `lib/environments` (and legacy env DB/model compatibility) have since been removed; the repo is workspace-first only. Kept for historical context.

**Context:** Template-Only Workspaces is canonical; old env-template system retired. No legacy runtime behavior to preserve. Pre-live / no critical production data assumed unless repo indicates otherwise.

**Scope:** Audit + plan only. No code changes.

---

## 1. Executive verdict

| Question | Answer |
|----------|--------|
| **Should we do a DB reset now?** | **Yes** (with caveats) |
| **Confidence** | **Medium–high** |

**Reasoning:** The schema has already been migrated from “environments” to “workspaces” in a rename migration (`20260307100000_rename_environments_to_workspaces.sql`), and the **physical table** is `workspaces` with `workspace_id`, `workspace_key`, `workspace_slug`. So a “reset” is less “wipe and recreate from zero” and more “squash migrations into one clean baseline and optionally fix remaining inconsistencies.” There is no evidence of production data; the rename migration comment says “no live production data to preserve.” A **migration squash** (replace many incremental migrations with one baseline schema) plus targeted cleanup gives a clean post-legacy baseline, avoids further rename/backfill chains, and sets a clear state for Variable Sets / Secrets and future features. The main caveat: confirm that no external system or manual DB use depends on current migration history or row counts before dropping and reapplying.

---

## 2. Legacy schema findings

| Table / column / file | Why it’s legacy | Recommendation |
|------------------------|----------------|----------------|
| **audit_events.environment_id** | Column created in `20260321120000_audit_events.sql` *after* the rename migration. Rename in `20260307100000` runs before `audit_events` exists, so the column was never renamed to `workspace_id`. Naming is inconsistent with `workspaces` and `requests_index`. | **Migrate:** Add migration to rename `audit_events.environment_id` → `workspace_id` (or include in baseline if doing reset). |
| **requests_index** column names in docs | **POSTGRES_INDEX.md** documents `environment_key`, `environment_slug`. Actual schema (after `20260307100000`) is `workspace_key`, `workspace_slug`. Code in `lib/db/requestsList.ts` and `lib/db/indexer.ts` uses `workspace_*`. | **Update docs** to `workspace_key` / `workspace_slug`. No DB change. |
| **workspaces.template_id / template_version nullable** | Template-only model requires both; they are still nullable in the type and likely in the table. | **Migrate (or baseline):** Make `template_id` and `template_version` NOT NULL in schema; app already enforces at create. |
| **workspaces.template_inputs** | JSONB, default `'{}'`. Aligns with template-only; no legacy concern. | **Keep.** |
| **Migration chain (19 files)** | Many steps (environments → org → rename → project_roles → template_inputs → audit_events, etc.). No production data to preserve. | **Reset/squash:** Replace with a single baseline schema (see §7) if doing full reset; otherwise leave as-is and only add fixups. |
| **requests_index.org_id** | Added in `20260320003000`; NOT NULL. Required for tenancy. | **Keep.** |
| **Request doc shape (S3) / indexer RequestDocForIndex** | Indexer still accepts deprecated `environment_key`, `environment_slug`, `environment_id` for backward compatibility when projecting to `workspace_key` / `workspace_slug`. | **Later:** Once all writers use `workspace_*`, drop deprecated fields from type and stop reading them in projection. |

---

## 3. Compatibility layer findings

| File | Purpose | Recommendation |
|------|---------|----------------|
| **lib/db/environments.ts** | Shim: re-exports workspace CRUD as `createEnvironment`, `getEnvironmentById`, etc.; maps `Workspace` ↔ `Environment` type. Used by `app/api/environments/route.ts`, deploy/destroy routes, tests. | **Remove later:** After retiring `/api/environments` or moving callers to workspace APIs, delete and have callers use `lib/db/workspaces` and `Workspace` type. |
| **lib/environments/envSkeleton.ts** | Delegates to `workspaceSkeleton`; exports `INVALID_ENV_TEMPLATE` for env deploy route. Used by `app/api/environments/[id]/deploy/route.ts` and tests. | **Remove later:** When env deploy route is removed or switched to call `workspaceSkeleton` directly, delete and update error handling to use workspace error codes. |
| **lib/environments/helpers.ts** | Re-exports workspace helpers as `validateCreateEnvironmentBody`, `validateEnvironmentSlug`, `computeEnvRoot`, `resolveEnvironmentRef`. Used by env route and tests. | **Remove later:** When env route is retired, migrate callers to `lib/workspaces/helpers` and delete. |
| **lib/environments/activity.ts**, **getEnvironmentDeployStatus.ts**, **isEnvironmentDeployed.ts**, **checkDeployBranch.ts** | Environment-named wrappers or logic for activity, deploy status, deploy branch. Used by env and/or workspace routes. | **Later:** Prefer workspace-named modules and single implementation; keep until env routes are removed or refactored. |
| **lib/requests/resolveRequestEnvironment.ts**, **assertEnvironmentImmutability.ts**, **requireEnvFields.ts**, **auditMissingEnv.ts** | Request layer still uses “environment” in names; resolve workspace from request. | **Later:** Rename to workspace (e.g. `resolveRequestWorkspace`, `assertWorkspaceImmutability`) and update callers in one pass. |
| **lib/db/requestsList.ts** | `listRequestIndexRowsByEnvironment` is a deprecated alias for `listRequestIndexRowsByWorkspace`. No remaining TS callers; only test comment and docs. | **Remove now:** Delete alias; update doc references to `listRequestIndexRowsByWorkspace`. |
| **lib/db/indexer.ts** | `RequestDocForIndex` has deprecated `environment_key`, `environment_slug`, `environment_id`; projection uses `workspace_key` / `workspace_slug` with fallback from env names. | **Keep for now:** Request S3 docs and workflow payloads may still contain env names; remove deprecated fields once all writers use workspace_* only. |
| **app/api/environments/** | GET/POST list/create, GET by id, POST deploy, POST destroy. All delegate to workspace DB and (for deploy) envSkeleton → workspaceSkeleton. | **Deprecate then remove:** Return 410 with clear message and point to `/api/workspaces` and project-scoped workspace URLs; after clients migrate, delete. |
| **lib/github/envDestroyRunIndex.ts**, **lib/github/envDriftRunIndex.ts** | S3 run-index keys and types still named “env”. Behavior is workspace-scoped. | **Later:** Rename to workspace (e.g. `workspaceDestroyRunIndex`) when doing a broader naming pass. |

---

## 4. Naming / domain debt (high value only)

- **“Environment” vs “workspace” in public API and types**  
  - **API:** `GET/POST /api/environments`, `GET /api/environments/:id`, `POST .../deploy`, `POST .../destroy` still use “environment” while the backing table and model are “workspace.”  
  - **Types:** `Environment` in `lib/db/environments.ts` is a view over `Workspace`; request types and many libs still use `environment_id`, `environment_key`, `environment_slug`.  
  - **Recommendation:** Do not rename everything at once. (1) Document that “environment” in API and request payloads is legacy naming for “workspace.” (2) When retiring `/api/environments`, expose only workspace APIs and use `workspace_id` / `workspace_key` / `workspace_slug` in responses and request docs. (3) In a later pass, rename internal types and S3/run-index keys to “workspace” where it avoids confusion.

- **POSTGRES_INDEX.md and activity filtering**  
  - Doc still says `environment_key`, `environment_slug` and `listRequestIndexRowsByEnvironment`. Actual schema and canonical function are `workspace_key`, `workspace_slug`, `listRequestIndexRowsByWorkspace`.  
  - **Recommendation:** Update POSTGRES_INDEX.md (and any other references) to use workspace column names and function name.

- **RUN_INDEX.md**  
  - “Environment destroy index” and “Environment drift index” and paths like `env-destroy/`, `env-drift/` are workspace-scoped.  
  - **Recommendation:** In a later doc pass, rename to “Workspace destroy/drift index” and align path names with workspace terminology where you touch those sections.

- **Error and audit constants**  
  - `INVALID_ENV_TEMPLATE`, `ENV_TEMPLATES_NOT_INITIALIZED`, audit `entity_type: "environment"` remain for compatibility.  
  - **Recommendation:** Keep until env routes are gone; then switch to workspace-scoped error and entity names where appropriate.

---

## 5. Dead assets

- **Code**
  - No fully dead files found (all imports still used). Deprecated aliases: `listRequestIndexRowsByEnvironment` (no TS callers; only docs/test comment).
  - **Scripts:** `scripts/validate-legacy-env.ts` and `scripts/verify-isEnvironmentDeployed.ts` are still relevant (guard legacy patterns and verify deploy check). Not dead; consider renaming or moving under a “compat” or “workspace” script name later.

- **Tests**
  - **environmentActivityRoute.test.ts** and **environmentActivity.test.ts** exercise activity and build logic; they may still hit `GET /api/environments/:id/activity`. The only activity route found in app is `app/api/workspaces/[id]/activity/route.ts`. If env activity route was removed, these tests are either mocking or are stale. **Recommendation:** Confirm whether an env activity route exists (e.g. via redirect or shared handler); if not, update or remove tests that assume `/api/environments/:id/activity`.
  - Tests that only assert “environment” response shape or env-specific error messages are transitional; once env routes are deprecated, update them to assert workspace API shape or remove.

- **Docs**
  - **POSTGRES_INDEX.md:** Stale column names (`environment_key`, `environment_slug`) and reference to `listRequestIndexRowsByEnvironment`; activity section still says “Environment activity.”
  - **API.md:** Still documents `GET /api/environments/:id/activity`; confirm if this route exists or is served by workspace route.
  - **ORG_SUPPORT_FORENSIC_REPORT.md**, **ARCHITECTURE_DELTA_PROJECT_TO_WORKSPACE.md:** Reference old env names and `listRequestIndexRowsByEnvironment`; update when touching those sections.
  - **plans-and-deltas/** (e.g. ENVIRONMENT_TEMPLATES_*, ENV_TEMPLATES_*, ENVIRONMENTS_*): Historical; keep for context but mark as superseded by Template-Only / workspace-first where relevant.

- **Scripts**
  - No scripts identified as completely dead. `validate-legacy-env` and `verify-isEnvironmentDeployed` remain useful; consider naming aligned with “workspace” later.

---

## 6. Recommended reset plan

### Phase A — Audit confirmations / backups

- Confirm no production or long-lived data: no DB backup required for “wipe” if truly pre-live; if any chance of real data, export `workspaces`, `requests_index`, `audit_events`, `projects`, `orgs`, `org_memberships` for reference.
- Document current migration state: list applied migrations and final schema (e.g. via `pg_dump --schema-only` or introspection).
- Confirm no external dependency on migration filenames or count (CI, runbooks, onboarding).

### Phase B — Schema reset / migration squash strategy

- **Option 1 (full squash):**  
  - Add a single new migration (e.g. `20260314000000_baseline_post_template_only.sql`) that:  
    - Drops all tables in dependency order (audit_events, requests_index, workspaces, projects, team_*, orgs, etc.).  
    - Creates them in one go with the **target baseline schema** (see §7).  
  - Record in a one-off doc or README that “baseline replaces migrations 20260301… through 20260324” and that existing DBs should be recreated or restored from backup before applying.  
  - Do **not** delete old migration files yet if other environments might run them; or move them to an `archive/` and have tooling run only the baseline.

- **Option 2 (minimal fixups, no squash):**  
  - Add a small migration that only: (1) renames `audit_events.environment_id` → `workspace_id` (if table exists and column exists), (2) optionally alters `workspaces` to make `template_id` and `template_version` NOT NULL if acceptable.  
  - Update POSTGRES_INDEX.md and any other docs to use `workspace_key` / `workspace_slug` and `listRequestIndexRowsByWorkspace`.  
  - Leaves migration history intact; less clean than a full baseline but lower risk if migration order is relied on elsewhere.

### Phase C — Reseed baseline data

- **Org/project/workspace:** If DB was wiped, reseed at least one org, one project, and one workspace (with valid `template_id`, `template_version`, `template_inputs`) for E2E and manual testing.
- **Templates:** S3 workspace template index and at least one template document (e.g. via existing seed route or script).
- **requests_index:** Will repopulate via normal write-through when requests are created; or run `db:rebuild-index` if you have existing S3 request docs to reindex.
- **Run indexes (S3):** No need to “reseed”; they are created on demand when workflows are dispatched.

### Phase D — E2E verification

- Run full test suite after schema and code changes.
- Manually: create org → project → workspace (from template) → create request → plan → approve → apply (or equivalent happy path); confirm activity and deploy status.
- If env routes still exist, verify they still work against the same DB (workspace table) and that deprecated aliases (e.g. listRequestIndexRowsByEnvironment) are removed or harmless.

### Phase E — Post-reset cleanup

- Remove deprecated alias `listRequestIndexRowsByEnvironment` and update all references to `listRequestIndexRowsByWorkspace`.
- Update POSTGRES_INDEX.md (and any other docs) to reflect actual schema and function names.
- Optionally: one pass to rename `audit_events.environment_id` in code/docs to `workspace_id` if column was renamed.
- Plan follow-up: deprecate `POST/GET /api/environments` and env deploy/destroy (410 + message pointing to workspaces), then remove `lib/db/environments.ts`, envSkeleton, and env helpers once no callers remain.

---

## 7. Proposed target baseline (post-reset)

**Canonical entities (source of truth in Postgres where applicable):**

- **orgs** — id, slug, name, archived_at, etc.
- **org_memberships** — org_id, login, role.
- **teams** / **team_memberships** / **project_team_access** — as today.
- **projects** — id, org_id, project_key, name, repo_full_name, default_branch.
- **workspaces** — workspace_id (PK), org_id, project_key, repo_full_name, workspace_key, workspace_slug, **template_id (NOT NULL)**, **template_version (NOT NULL)**, template_inputs (JSONB, default '{}'), created_at, updated_at, archived_at. Unique on (repo_full_name, workspace_key, workspace_slug).

**Projections / index only:**

- **requests_index** — request_id (PK), org_id, created_at, updated_at, repo_full_name, **workspace_key**, **workspace_slug**, module_key, actor, pr_number, merged_sha, last_activity_at, doc_hash. No lifecycle/status columns; S3 request docs remain authoritative.
- **audit_events** — id, org_id, actor_login, source, event_type, entity_type, entity_id, created_at, metadata, request_id, **workspace_id** (not environment_id), project_key.

**S3 / external canonical:**

- Request documents (S3): authoritative for request lifecycle and status; should standardize on `workspace_id`, `workspace_key`, `workspace_slug` in payloads over time.
- Workspace template index and documents (S3): canonical for template list and document content.
- Run indexes (S3): plan, apply, destroy, cleanup, drift_plan; correlation only.

**Intentionally gone or deprecated:**

- No “environments” table (replaced by workspaces).
- No `environment_id` / `environment_key` / `environment_slug` in schema (replaced by workspace_*).
- No blank template; no static env-template config; no env-templates-store.
- Optional: `/api/environments` routes return 410 and point to workspace APIs until removed.

---

## 8. Risks

- **Breaking existing environments:** If any DB was created with the current migrations and has data, a full squash (drop all tables) will destroy it. Mitigation: only do full reset where “no production data” is confirmed; otherwise use Option 2 (fixup migrations only).
- **Migration order / tooling:** If CI or deploy assumes a specific number or order of migrations, squashing may break that. Mitigation: document new process (e.g. “run baseline only on fresh DB”) and update CI to run baseline or to skip old migrations.
- **Request S3 docs and workflow payloads:** If they still send `environment_key` / `environment_slug` / `environment_id`, the indexer’s fallback (environment_* → workspace_*) must remain until all writers are updated. Removing the fallback too early could break indexing.
- **Env routes and clients:** Deprecating or removing `/api/environments` can break any client or UI that still calls them. Mitigation: deprecate with 410 and a clear body message; give callers time to switch to workspace APIs before removal.
- **Audit and reporting:** Renaming `audit_events.environment_id` to `workspace_id` may affect any reporting or queries that filter by that column. Mitigation: update those queries in the same change set.

---

## Summary

- **DB reset:** Recommended as a **migration squash** to a single baseline schema (or, if you prefer minimal risk, only add fixup migrations for `audit_events.environment_id` and optional NOT NULL on workspace template fields).
- **Schema:** Physical model is already workspace-based; remaining legacy is naming (`audit_events.environment_id`), doc references (`environment_key`/`environment_slug` in POSTGRES_INDEX), and optional nullability of template fields.
- **Compatibility:** Retire env routes and shims in a planned sequence (deprecate → migrate callers → remove); remove `listRequestIndexRowsByEnvironment` and update docs now.
- **Naming:** High-value cleanup is aligning docs and public API with “workspace” and fixing POSTGRES_INDEX; deeper renames can follow in a later pass.
- **Dead assets:** No fully dead code files; one deprecated alias and several stale doc references; tests for “environment activity” need confirmation against actual routes (workspace-only activity).

This positions the codebase for a clean post-legacy baseline and a straightforward path to Variable Sets / Secrets and future workspace-run features.
