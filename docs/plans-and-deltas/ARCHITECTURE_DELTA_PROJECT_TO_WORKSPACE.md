# Architecture Delta: Environment → Workspace Terminology Refactor

## Status

Design delta. No live production data to preserve. Clean hard refactor recommended.

**Scope:** Terminology and domain-model rename across the full TfPilot stack. No behavioral changes to lifecycle, storage, or execution model.

---

# 1. Problem Statement

TfPilot's current hierarchy is **Organization → Project → Environment → Request**. In practice, the **Environment** is the true deployable Terraform unit:

- It owns the Terraform root (`envs/<key>/<slug>/`)
- It is the target of deploy, destroy, plan, apply, and drift detection
- Requests are scoped to it
- RBAC project access gates it
- Users mentally treat it as "the thing I'm working in"

Meanwhile, **Project** acts as a lightweight grouping/metadata layer — it holds `repo_full_name`, `default_branch`, and `project_key`, and serves as the RBAC boundary. Projects are implicitly derived when environments are created; users rarely interact with "Project" as a standalone concept.

This creates three problems:

1. **Naming mismatch with Terraform Cloud.** In TFC, a *workspace* is the deployable unit (state, variables, runs). TfPilot's "Environment" fills this role but uses a different name, confusing users who know TFC.
2. **Internal ambiguity.** "Environment" in infrastructure usually means dev/staging/prod — a tier, not a deployment unit. TfPilot's `environment_key` (dev, prod) is closer to that meaning, but the `Environment` entity is something else entirely.
3. **UI confusion.** "Create Environment" suggests creating a dev/prod tier. Users expect "Create Workspace" when they mean "create a new Terraform root I can deploy to."

---

# 2. Current Model

```
Organization
└── Project (project_key, repo_full_name, default_branch)
    └── Environment (environment_key, environment_slug, template)
        └── Request (module, terraform file, PR, runs)
```

### What each concept currently means

| Concept | Identity | Role | Authoritative store |
|---------|----------|------|---------------------|
| **Organization** | `orgs.id`, `orgs.slug` | Tenant boundary. All resources scoped here. | Postgres (authoritative) |
| **Project** | `projects.id`, `project_key` | Groups environments under a repo. RBAC boundary (`project_user_roles`, `project_team_roles`, `project_team_access`). | Postgres (authoritative) |
| **Environment** | `environments.environment_id` | Deployable Terraform root. Owns `envs/<key>/<slug>/`, backend state, deploy/destroy lifecycle, activity timeline, drift detection. | Postgres (authoritative for identity); GitHub repo for deploy state |
| **Request** | `request_id` | Single infrastructure change. One `.tf` file per request. PR-native lifecycle. | S3 (authoritative); Postgres `requests_index` (projection) |

### Current reality

- Projects are created as a side-effect of environment creation or exist as admin-configured metadata. Users do not "manage projects" as a primary workflow.
- Environments are the primary entity users interact with: create, deploy, view activity, create requests against, destroy.
- RBAC is enforced at the Project level, not the Environment level.

---

# 3. Target Model

```
Organization
└── Project (project_key, repo_full_name, default_branch)
    └── Workspace (workspace_key, workspace_slug, template)
        └── Request (module, terraform file, PR, runs)
```

### What each concept means in the target model

| Concept | New name | Role |
|---------|----------|------|
| **Organization** | Organization (unchanged) | Tenant boundary |
| **Project** | Project (unchanged) | Repo grouping + RBAC boundary. Maps to a GitHub repo. Contains one or more Workspaces. |
| **Workspace** | Workspace (was Environment) | Deployable Terraform root. Owns state, runs, drift, activity. Aligns with Terraform Cloud "workspace" concept. |
| **Request** | Request (unchanged) | Single infrastructure change targeting a Workspace |

### Core invariants (non-negotiable)

These definitions are platform invariants. All code, RBAC, UI, and documentation must conform to them.

- **Workspace = Terraform root + state boundary.** A Workspace owns exactly one Terraform root directory (`envs/<key>/<slug>/`), exactly one state file, and all runs (plan/apply/destroy/drift) targeting that root. It is the deployable unit.
- **Project = repo grouping + RBAC boundary.** A Project maps to one GitHub repo and contains one or more Workspaces. All permission checks (plan, approve, apply, destroy, deploy) are resolved at the Project level. Workspaces inherit project permissions.

### Why "Workspace"

- Terraform Cloud uses "Workspace" for the deployable unit with its own state, variables, and run history. This is exactly what TfPilot's Environment is.
- "workspace_key" (dev, prod) replaces "environment_key" — the tier/stage concept remains, just under the workspace umbrella.
- No collision with OS/IDE "workspace" — TfPilot is infrastructure tooling where Terraform Cloud terminology is the natural frame of reference.

---

# 4. Exact Rename Map

### Entity rename

| Current | Target |
|---------|--------|
| `Environment` | `Workspace` |
| `environment_id` | `workspace_id` |
| `environment_key` | `workspace_key` |
| `environment_slug` | `workspace_slug` |
| `environment_key` (dev/prod) | `workspace_key` (dev/prod) |

### Table rename

| Current table | Target table |
|---------------|-------------|
| `environments` | `workspaces` |

### Column renames (across tables)

| Table | Current column | Target column |
|-------|---------------|---------------|
| `workspaces` (was `environments`) | `environment_id` | `workspace_id` |
| `workspaces` | `environment_key` | `workspace_key` |
| `workspaces` | `environment_slug` | `workspace_slug` |
| `requests_index` | `environment_key` | `workspace_key` |
| `requests_index` | `environment_slug` | `workspace_slug` |
| `requests_index` | `environment_id` | `workspace_id` |

### API route renames

| Current | Target |
|---------|--------|
| `/api/environments` | `/api/workspaces` |
| `/api/environments/[id]` | `/api/workspaces/[id]` |
| `/api/environments/[id]/deploy` | `/api/workspaces/[id]/deploy` |
| `/api/environments/[id]/destroy` | `/api/workspaces/[id]/destroy` |
| `/api/environments/[id]/activity` | `/api/workspaces/[id]/activity` |
| `/api/environments/[id]/drift-latest` | `/api/workspaces/[id]/drift-latest` |

### App page renames

| Current | Target |
|---------|--------|
| `/environments` | `/projects` |
| `/environments/[id]` | `/projects/[projectId]` (project detail with workspaces list) |
| `/environments/new` | `/projects/[projectId]/workspaces/new` |
| (new) | `/projects/[projectId]/workspaces/[id]` (workspace detail) |
| `/catalogue/environments` | `/catalogue/workspaces` |
| `/catalogue/environments/[id]` | `/catalogue/workspaces/[id]` |

### lib/ directory renames

| Current | Target |
|---------|--------|
| `lib/environments/` | `lib/workspaces/` |
| `lib/db/environments.ts` | `lib/db/workspaces.ts` |

### UI text renames

| Current | Target |
|---------|--------|
| "Environments" (sidebar, page titles) | "Workspaces" |
| "Environment detail" | "Workspace detail" |
| "Create Environment" | "Create Workspace" |
| "Deploy Environment" | "Deploy Workspace" |
| "Destroy Environment" | "Destroy Workspace" |
| "Environment must be deployed before creating resources" | "Workspace must be deployed before creating resources" |
| "Environment deployment in progress" | "Workspace deployment in progress" |
| "Environment Templates" | "Workspace Templates" |
| "environment activity" / "Environment Activity" | "workspace activity" / "Workspace Activity" |
| "ENV_DEPLOY_CHECK_FAILED" | "WORKSPACE_DEPLOY_CHECK_FAILED" |
| "INVALID_ENV_TEMPLATE" | "INVALID_WORKSPACE_TEMPLATE" |

### Request document field renames

| Current | Target |
|---------|--------|
| `environment_key` | `workspace_key` |
| `environment_slug` | `workspace_slug` |
| `environment_id` | `workspace_id` |

### What remains "Project"

- `projects` table — unchanged
- `project_key` — unchanged
- `project_user_roles`, `project_team_roles`, `project_team_access` — unchanged
- `/api/org/projects` routes — unchanged
- RBAC project permission model — unchanged

### What remains unchanged in Terraform repos

- `envs/<key>/<slug>/` directory structure in infra repos — **unchanged**. The on-disk path convention (`envs/`) is a repo-level concern and does not need to track the platform terminology rename. Renaming repo directories would break state, backends, and workflows for no user benefit.

### GitHub workflow input renames

| Current input | Target input |
|---------------|-------------|
| `environment_key` | `workspace_key` |
| `environment_slug` | `workspace_slug` |

Workflow YAML files in infra repos must update input names, working-directory variable references, and concurrency group strings to use `workspace_key`/`workspace_slug`.

---

# 5. Architecture Impact Areas

### 5.1 DB schema / table naming

- Rename `environments` → `workspaces` (table + all column references)
- Rename columns in `requests_index`: `environment_key` → `workspace_key`, `environment_slug` → `workspace_slug`, `environment_id` → `workspace_id`
- New migration file required. Since no live data to preserve: `DROP TABLE environments; CREATE TABLE workspaces ...` is acceptable.
- All migration files referencing `environments` or `environment_*` columns should be reviewed for consistency (existing migrations can remain as historical record; new migration applies the rename).

### 5.2 API routes

- Move `app/api/environments/` → `app/api/workspaces/` (all subroutes: `[id]`, `[id]/deploy`, `[id]/destroy`, `[id]/activity`, `[id]/drift-latest`)
- Update all internal references (`resolveRequestEnvironment` → `resolveRequestWorkspace`, etc.)
- Update request create/approve/apply/destroy routes: field names in request bodies and validation

### 5.3 App routes / pages

- Create `app/projects/` with project list, `[projectId]/page.tsx` project detail, and nested `[projectId]/workspaces/` (new, `[id]` detail)
- Remove `app/environments/` (replaced by project-scoped workspace pages)
- Move `app/catalogue/environments/` → `app/catalogue/workspaces/`
- Update `AppShell.tsx`: primary nav entry becomes "Projects", update `getPageTitle` mapping

### 5.4 lib/environments → lib/workspaces

All files:

| Current | Target | Key exports to rename |
|---------|--------|-----------------------|
| `lib/environments/helpers.ts` | `lib/workspaces/helpers.ts` | `computeEnvRoot` → `computeWorkspaceRoot`, `validateCreateEnvironmentBody` → `validateCreateWorkspaceBody` |
| `lib/environments/envSkeleton.ts` | `lib/workspaces/workspaceSkeleton.ts` | Function/type renames |
| `lib/environments/validateTemplateId.ts` | `lib/workspaces/validateTemplateId.ts` | Minimal rename |
| `lib/environments/activity.ts` | `lib/workspaces/activity.ts` | Type/function renames |
| `lib/environments/getEnvironmentDeployStatus.ts` | `lib/workspaces/getWorkspaceDeployStatus.ts` | Function rename |
| `lib/environments/isEnvironmentDeployed.ts` | `lib/workspaces/isWorkspaceDeployed.ts` | Function rename |
| `lib/environments/checkDeployBranch.ts` | `lib/workspaces/checkDeployBranch.ts` | Minimal rename |
| `lib/db/environments.ts` | `lib/db/workspaces.ts` | All functions: `createEnvironment` → `createWorkspace`, etc. |

### 5.5 lib/db/indexer.ts and lib/db/requestsList.ts

- Rename `environment_key` / `environment_slug` / `environment_id` in projection fields, SQL queries, and TypeScript types
- `RequestDocForIndex` type: field renames
- `listRequestIndexRowsByEnvironment` → `listRequestIndexRowsByWorkspace`

### 5.6 RBAC permission model

No structural change to RBAC. Permissions remain project-scoped. Functions to update:

- `requireRequestProjectPermission` — internal references to "environment" in comments/variable names
- `lib/auth/permissions.ts`: `userCanDeployEnv` → `userCanDeploy`, `deploy_env` permission key → `deploy`
- `lib/new-request-gate.ts` — variable/comment renames

### 5.7 Request document field names

S3 request documents: `environment_key` → `workspace_key`, `environment_slug` → `workspace_slug`, `environment_id` → `workspace_id`.

Since no live data to preserve, all request creation code simply uses the new field names. No migration of existing S3 documents needed.

`lib/requests/resolveRequestEnvironment.ts` → `lib/requests/resolveRequestWorkspace.ts`

### 5.8 Postgres projection fields

`lib/db/indexer.ts` must map request doc fields to the new column names. `lib/db/requestsList.ts` queries must use `workspace_key`, `workspace_slug`.

### 5.9 GitHub workflow inputs

Infra repo workflows (`plan.yml`, `apply.yml`, `destroy.yml`, `cleanup.yml`, `drift_plan.yml`) currently accept `environment_key` and `environment_slug` inputs. These must become `workspace_key` and `workspace_slug`.

TfPilot dispatch code (`lib/github/dispatch.ts` or equivalent) must send the renamed inputs.

### 5.10 Terraform repo paths

**No change to on-disk paths.** `envs/<key>/<slug>/` remains as-is. The `envs/` prefix is a repo-level convention; renaming it would break backends, state paths, and workflow working-directory references with no user-facing benefit.

### 5.11 Tests

- All test files referencing `environment`, `Environment`, `environment_key`, `environment_slug` must be updated
- `tests/invariants/` — lifecycle tests likely reference environment fields
- `tests/api/` — route tests for environment endpoints
- `tests/unit/` — permission and resolution tests

### 5.12 Docs

All docs referencing "Environment" as the deployable entity must be updated:

- `SYSTEM_OVERVIEW.md` — model description, repo structure, environment lifecycle section
- `RBAC.md` — permission matrix "Environments" section
- `ORGANISATIONS.md` — project access references
- `POSTGRES_INDEX.md` — column descriptions
- `API.md` — endpoint documentation
- `OPERATIONS.md` — runbook references
- `GLOSSARY.md` — term definitions
- `SCREAMING_ARCHITECTURE.md` — directory layout
- All existing deltas in `docs/plans-and-deltas/` — historical; add a note at the top of each that "Environment" now means "Workspace"
- `config/environment-templates.ts` → `config/workspace-templates.ts`

### 5.13 Audit events / UI text

- `audit_events` table: column `environment_id` → `workspace_id`. All audit event writes and reads that reference this column must use the new name. Docs describing the audit schema (`AUDIT_ACTIVITY_STREAM_MVP_PLAN.md`, any API docs listing audit fields) must reflect this.
- Error codes: `ENV_DEPLOY_CHECK_FAILED` → `WORKSPACE_DEPLOY_CHECK_FAILED`, `INVALID_ENV_TEMPLATE` → `INVALID_WORKSPACE_TEMPLATE`
- Deploy branch prefix: `deploy/<key>/<slug>` — no change needed (branch name is a convention, not user-facing terminology)
- Sidebar label: "Environments" → "Projects"
- Page titles, breadcrumbs, empty states, toast messages

---

# 6. Recommended Migration Strategy

### Approach: clean hard refactor

There is currently **no important live production data to preserve**. The recommended approach is a single, coordinated rename across the full stack — no compatibility shims, no dual-write, no temporary aliases.

### What can be renamed directly (no migration)

- All TypeScript code: types, interfaces, function names, variable names, imports
- All React components and pages (directory moves)
- API route directories
- lib/ directory structure
- UI text strings
- Test files
- Doc files
- Config files (`environment-templates.ts` → `workspace-templates.ts`)
- GitHub workflow dispatch input names (in TfPilot app code)

### What needs a one-time migration

- **Postgres schema:** New migration that renames the table and columns (or drops and recreates, since no data to preserve). Single migration file.
- **Infra repo workflows:** Workflow YAML input renames in each infra repo (`core-terraform`, `payments-terraform`, etc.). Must be coordinated with the TfPilot app deploy.
- **S3 request documents:** If any test/dev documents exist, they can be discarded and recreated. No migration needed.

### Temporary aliases: not recommended

Given no live data, aliases add complexity for zero benefit. A clean cut is faster and leaves no technical debt.

### Coordination requirement

The TfPilot app rename and the infra repo workflow input renames must be deployed together (or infra repos first). If TfPilot dispatches `workspace_key` but the workflow expects `environment_key`, dispatches will fail. Sequence:

1. Rename workflow inputs in infra repos and merge
2. Deploy TfPilot app with the full rename

---

# 7. RBAC Implications

### Current state

RBAC is enforced at the **Project** level:

- `project_user_roles` and `project_team_roles` gate actions (currently: plan, approve, apply, destroy, deploy_env)
- `project_team_access` gates which teams can access which projects
- Org admin bypasses to full project authority
- Environments (Workspaces) inherit access from their parent Project

### Recommendation: keep RBAC at Project level

RBAC remains attached to **Project only**. Workspaces inherit project permissions.

Rationale:

- Workspaces within a project share a repo; repo-level access is the natural boundary
- Adding per-workspace RBAC would multiply permission surfaces without clear user demand
- Terraform Cloud also groups workspace permissions under organizations/teams, not per-workspace
- The current model is simple, well-tested, and covers the access patterns needed

### Permission key cleanup

As part of this rename, normalize permission keys to not encode the entity name. Target permission set:

```
plan
approve
apply
destroy
deploy
manage_access
```

- Permission key `deploy_env` → `deploy`
- Helper `userCanDeployEnv` → `userCanDeploy`
- No new permission tables, no new role types
- Permission keys should describe the action only — the entity is always implied by the project context

### Future option

If per-workspace RBAC is needed later, it can be added as `workspace_user_roles` / `workspace_team_roles` without disrupting the project-level model. This delta does not propose that.

---

# 8. UI / Information Architecture Implications

### Recommended sidebar structure (post-rename)

```
Projects            ← primary nav entry (was "Environments")
Requests
Catalogue
  └── Workspace Templates    ← was "Environment Templates"
  └── Request Templates
Insights
Settings
  └── Members
  └── Teams
  └── Audit
  └── Organisations
```

Projects is the top-level entry. Workspaces live inside projects — matching Terraform Cloud's hierarchy where you navigate Organization → Project → Workspace.

### Page structure

| Route | Title | Content |
|-------|-------|---------|
| `/projects` | Projects | List of projects with workspace count, repo, last activity |
| `/projects/[projectId]` | Project Detail | Project info + list of workspaces (deploy status, key/slug, last activity) |
| `/projects/[projectId]/workspaces/new` | Create Workspace | Workspace key (dev/prod), slug, template (project already selected) |
| `/projects/[projectId]/workspaces/[id]` | Workspace Detail | Deploy status, activity timeline, linked requests, drift status |
| `/requests` | Requests | Request list (unchanged, filters by workspace instead of environment) |
| `/catalogue/workspaces` | Workspace Templates | Template catalogue |

### Key UX changes

- The primary navigation entry point is "Projects". Users land on the project list, then drill into a project to see its workspaces. This answers "where do projects live?" immediately.
- Workspace pages are nested under their project: `/projects/[projectId]/workspaces/[id]`. This makes the hierarchy explicit in the URL and in breadcrumbs.
- Request creation form: "Select Workspace" replaces "Select Environment". The workspace selector can be grouped by project.
- Workspace detail breadcrumb: `Projects > [Project Name] > [Workspace Slug]`
- Project detail page becomes a real surface — shows workspaces, team access, project roles. No longer a background concept.

---

# 9. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Workflow dispatch input mismatch** | High | Deploy infra repo workflow changes before TfPilot app. Test dispatch end-to-end in dev before prod. |
| **Route breakage (API consumers)** | Medium | No external API consumers currently. Internal SWR hooks will be updated in the same PR. |
| **Route breakage (bookmarks/links)** | Low | Add Next.js redirects from `/environments/*` → `/projects/*` for a transition period. |
| **Test breakage** | Medium | Full test suite must pass before merge. Rename is mechanical — search-and-replace with validation. |
| **Docs drift** | Medium | Update all canonical docs in the same PR batch. Add a header note to historical deltas. |
| **`envs/` directory confusion** | Low | Document clearly that `envs/` in repo paths is a Terraform convention and does not map 1:1 to the platform concept. |
| **Naming collision with Terraform `workspace` command** | Low | TfPilot explicitly does not use Terraform workspaces (CLI feature). Document this distinction. The ARCHITECTURE_DELTA_ENVIRONMENTS.md already states "No Terraform workspaces." |
| **Request field assumptions in S3 docs** | Low | No live data. All code paths updated together. |
| **GitHub branch prefix `deploy/<key>/<slug>`** | None | Branch prefix is a convention, not terminology. No rename needed. |
| **`environment_key` still means dev/prod** | Low | Now called `workspace_key`. The semantic meaning (tier/stage) is preserved. Document that `workspace_key` indicates the deployment tier. |

---

# 10. Recommendation

**Keep Project + Workspace.** Do not collapse to Workspace only.

### Justification

1. **RBAC boundary.** Project is the permission boundary. Collapsing would require moving all RBAC to the workspace level, multiplying permission surfaces and admin overhead.
2. **Repo mapping.** A Project maps to a GitHub repo (`repo_full_name`, `default_branch`). Multiple workspaces share one repo. Without Project, each workspace would need its own repo reference, duplicating data and losing the grouping benefit.
3. **Terraform Cloud alignment.** TFC has Organizations → Projects → Workspaces. Keeping Project maintains parity.
4. **Team access.** `project_team_access` grants team access to all workspaces in a project. This is the right granularity — teams typically operate on a repo, not individual workspaces within it.
5. **Future growth.** Project can grow into a first-class management surface (project settings, default templates, project-level policies) without restructuring.

Collapsing to Workspace only would lose the repo grouping abstraction and force RBAC down to a more granular level with no current demand for that granularity.

---

# 11. Platform Invariants Preserved

This delta does not change any platform invariant:

| Invariant | Impact |
|-----------|--------|
| **Workspace = Terraform root + state boundary** | New invariant. Replaces "Environment" as the deployable unit definition. |
| **Project = repo grouping + RBAC boundary** | New invariant. Formalizes what Project already is in practice. |
| Terraform runs only in GitHub Actions | No change. Rename is terminology only. |
| S3 request documents are authoritative | No change. Field names in docs change; storage model unchanged. |
| Lifecycle/status are fact-derived | No change. `deriveLifecycleStatus` is unaffected. |
| Postgres is projection/access store | No change. Table/column renames; role unchanged. |
| Deterministic/idempotent behavior | No change. Rename is mechanical. |
| One file per request | No change. Path convention unchanged. |
| GitHub is execution boundary | No change. |

---

# 12. Recommended Execution Order

Execute as a single coordinated effort. Recommended phase order within that effort:

### Phase 1: Schema + data layer

1. Write new Postgres migration: rename `environments` → `workspaces`, rename columns in `workspaces` and `requests_index`
2. Rename `lib/db/environments.ts` → `lib/db/workspaces.ts` (all functions, types, queries)
3. Rename `lib/db/indexer.ts` projection fields
4. Rename `lib/db/requestsList.ts` query fields and functions
5. Run migration, verify schema

### Phase 2: Domain logic (lib/)

6. Rename `lib/environments/` → `lib/workspaces/` (all files, exports, types)
7. Rename `lib/requests/resolveRequestEnvironment.ts` → `resolveRequestWorkspace.ts`
8. Rename `lib/new-request-gate.ts` references
9. Rename `lib/auth/permissions.ts` (`deploy_env` → `deploy`, `userCanDeployEnv` → `userCanDeploy`)
10. Update `config/environment-templates.ts` → `config/workspace-templates.ts`

### Phase 3: API routes

11. Move `app/api/environments/` → `app/api/workspaces/` (all subroutes)
12. Update request API routes (field names in bodies, validation, resolution)
13. Update GitHub dispatch code (input field names)

### Phase 4: Infra repo workflows (external)

14. Rename workflow inputs in each infra repo (`core-terraform`, `payments-terraform`)
15. Merge and verify workflow dispatch works end-to-end

### Phase 5: App pages + UI

16. Create `app/projects/` with project list page, `[projectId]/` detail page, and nested `[projectId]/workspaces/` (new, `[id]` detail)
17. Remove `app/environments/` (replaced by project-scoped workspace pages)
18. Move `app/catalogue/environments/` → `app/catalogue/workspaces/`
19. Update `AppShell.tsx` nav items ("Projects" as primary entry), page titles, breadcrumbs
20. Update all UI text strings, error codes, empty states
21. Add Next.js redirects from old `/environments/*` → `/projects/*` routes

### Phase 6: Tests + docs

22. Update all test files (search-and-replace + validation)
23. Run full test suite
24. Update all canonical docs
25. Add historical note to existing architecture deltas

### Deployment sequence

- Merge infra repo workflow changes first (Phase 4)
- Deploy TfPilot app with Phases 1-3, 5-6 in a single release
- Verify end-to-end: create workspace → deploy → create request → plan → apply
