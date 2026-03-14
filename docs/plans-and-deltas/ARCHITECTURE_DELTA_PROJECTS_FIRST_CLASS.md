# Architecture Delta: Projects as First-Class Resources

## Status

**Implemented** (Phases A–E, 2026-03). Projects and workspaces are now first-class resources with user-managed lifecycle. The design addressed the UI/IA inconsistency introduced by adopting project-first navigation before projects were user-manageable.

---

## 1. Problem Statement

TfPilot's Phase 9 UI refactor introduced a **Project → Workspace** navigation hierarchy:

```
/projects
/projects/[projectId]
/projects/[projectId]/workspaces/[workspaceId]
```

The sidebar now shows **Projects** as the primary entry point, with workspaces nested underneath. This mirrors Terraform Cloud's model and is the correct long-term IA.

**However, a fundamental flaw exists:** Projects are not user-manageable resources. Users cannot create a project. Users navigate to `/projects` and see a list populated entirely by past side-effects of workspace creation — or they see an empty state that says "Projects are created when you create a workspace." This contradicts the hierarchy the UI presents.

This creates three concrete problems:

**1. Inverted dependency in UX.**
The UI hierarchy implies: create a Project, then create Workspaces inside it. But the actual flow is the reverse: create a Workspace, which causes a project to materialise. The primary navigation entry point is a dead-end for new users.

**2. RBAC attached to a non-first-class entity.**
`project_user_roles`, `project_team_roles`, and `project_team_access` are all keyed on `project.id`. Access control is already project-scoped and fully implemented — but users can only manage these roles after stumbling into a project that appeared as a workspace side-effect. There is no flow for "create a project and configure its access before creating workspaces."

**3. The hierarchy in the sidebar is fictitious.**
Projects appear in the sidebar because they exist in the DB. But neither the sidebar nor any page explains how projects are created, what they represent, or how to manage them. The navigation hierarchy communicates a mental model the product does not yet support.

---

## 2. Current State (post-implementation)

### What exists

| Layer | Reality |
|-------|---------|
| **DB schema** | `projects` table: `id, org_id, project_key, name, repo_full_name, default_branch, created_at, updated_at, UNIQUE(org_id, project_key)`. `workspaces` table stores `project_key`, `repo_full_name` (copied at creation). |
| **RBAC** | Fully project-scoped: `project_user_roles`, `project_team_roles`. Enforced at `project.id`. |
| **Workspace creation** | Requires project to exist. Reads `repo_full_name` and `default_branch` **from `projects` table only**. No static config dependency. |
| **API** | `GET/POST /api/projects`, `GET/PATCH /api/projects/[projectId]`, `GET/POST /api/workspaces`. Project routes accept `project_key` or `id` in URL. |
| **UI** | `/projects` list, `/projects/new` creation form, `/projects/[projectId]` (Workspaces/Settings/Access tabs), empty state with "New Project" CTA. |
| **Sidebar** | Projects group with "All projects", "New project", and dynamic project links. |
| **Audit** | `GET /api/admin/audit/workspaces-missing-project` — lists workspaces whose `project_key` has no matching project row (platform-admin only). |

### Static config

The `infra-repos` config is **no longer used** for workspace creation. It may remain for dev/seeding. `projects.repo_full_name` and `projects.default_branch` are the authoritative source for workspace bootstrap.

---

## 3. Decision

**Recommendation: Option A — Make Projects first-class resources.**

Option B (revert to workspace-first IA) would:
- Require rolling back the navigation restructuring already done
- Lose Terraform Cloud alignment
- Leave RBAC in an orphaned state (attached to entities users can't manage)
- Defer a necessary correction, not avoid it

Option A is recommended because:
1. The `projects` table already has the schema required — `repo_full_name`, `default_branch`, `name`, RBAC foreign keys. The DB foundation is in place.
2. Workspace creation already enforces that a project must pre-exist. The hard dependency exists; the user-facing creation path does not.
3. RBAC is already project-scoped. First-class projects complete the RBAC story rather than introduce new complexity.
4. The implementation gap is narrow: add `POST /api/projects`, a creation UI, and route infra repo resolution through the projects table instead of the static config.
5. Terraform Cloud's model is exactly this: create a project, then create workspaces in it.

---

## 4. Target Model

```
Organization
└── Project (user-created, user-managed)
    ├── Workspaces
    │   └── Workspace (Terraform root + state boundary)
    │       └── Request (infra change, PR-native)
    ├── Access (team/user roles on this project)
    └── Settings (name, repo, branch)
```

### Invariants (unchanged)

- **Workspace = Terraform root + state boundary.** A workspace owns `envs/<key>/<slug>/`, backend state, deploy/destroy lifecycle.
- **Project = repo grouping + RBAC boundary.** A project defines the infra repo, the default branch, and the permission surface for all workspaces inside it.

### What "first-class project" means

A project is:
- **User-created** — an explicit creation step, not a side-effect
- **Named** — human-readable name separate from `project_key`
- **Repo-bound** — `repo_full_name` and `default_branch` are set at project creation and are the authoritative source for workspace operations
- **RBAC-bounded** — team and user access is configured per-project, ideally before workspaces are created
- **Independently viewable and manageable** — has its own detail page, settings, and access management

---

## 5. Required Capabilities

### Project lifecycle

| Capability | Status |
|------------|--------|
| List projects | ✅ `GET /api/projects` |
| View project | ✅ `/projects/[projectId]` |
| Create project | ✅ `POST /api/projects`, `/projects/new` |
| Update project metadata | ✅ `PATCH /api/projects/[projectId]`, `/projects/[projectId]/settings` |
| Delete/archive project | Deferred (post-MVP) |

### Project creation inputs

A project creation form must collect:
- `name` — human-readable display name (e.g. "Payments Infrastructure")
- `project_key` — URL-safe key, must be unique per org (e.g. `payments`)
- `repo_full_name` — the GitHub repo that owns the Terraform (e.g. `acme/payments-terraform`)
- `default_branch` — the base branch for PRs (e.g. `main`)

`project_key` must be validated: lowercase, alphanumeric + hyphens, unique per org.

### Workspace creation

Workspace creation must read `repo_full_name` and `default_branch` from `projects` table — not from the static `infra-repos` config. The static config becomes optional/dev-only tooling.

### Access management

The project access page (`/projects/[projectId]/access`) must be reachable from the project detail view, not only discoverable via Settings. Teams and user roles should be configurable on a newly created project before any workspace is created.

### Empty states

- `/projects` empty state: "No projects yet. Create your first project to get started." with a CTA.
- `/projects/[projectId]` workspaces section: "No workspaces yet. Create one to start deploying infrastructure." with a CTA to `/projects/[projectId]/workspaces/new`.

---

## 6. Architecture Impact

### DB schema

No migration required for the core change. The `projects` table already has all required columns. Required change: add `createProject` and `updateProject` functions to `lib/db/projects.ts`. These are additive.

One migration **will be needed**: remove the FK/dependency on `infra-repos` config for workspace creation by ensuring `projects.repo_full_name` is the authoritative source. The `workspaces` table already stores `repo_full_name` (copied at creation time) — this is correct and should remain.

The `infra-repos` static config can be kept as a seeding/dev convenience for creating projects from config, but must not be required for runtime operation.

### API routes

| Route | Status |
|-------|--------|
| `GET /api/projects` | List projects (org-scoped). |
| `POST /api/projects` | Create project. Validates uniqueness. Assigns creator as admin. |
| `GET /api/projects/[projectId]` | Project detail (accepts `project_key` or id). Workspace count. |
| `PATCH /api/projects/[projectId]` | Update name, repo, branch. Requires `manage_access`. |
| `POST /api/workspaces` | Creates workspace. Reads `repo_full_name`, `default_branch` from `projects` table only. |
| `GET /api/admin/audit/workspaces-missing-project` | Orphaned workspace audit (platform-admin). Optional `?org_id=`. |

### Workspace creation flow

```
POST /api/workspaces
→ getProjectByKey (must exist)
→ read repo_full_name, default_branch from project record
→ fail 400 if missing
→ createWorkspace, createBootstrapPr
```

Static `resolveInfraRepoByProjectAndEnvKey` is no longer used for workspace creation.

### RBAC

No structural change needed. RBAC is already project-scoped. The only addition: project creation should assign the creating user as project `admin` automatically.

### Sidebar / routing

Current routing is correct. No changes needed to page routes. The sidebar already supports dynamic project children.

The empty state on `/projects` needs a "New Project" button. The project detail page needs a prominent "Settings" tab that includes project metadata and access management.

### Teams/access UI

The Teams feature already exists under `/settings/teams`. The project-level access assignment (`AssignTeamProjectDialog`) is already implemented. No structural change needed. Access management should be linked more prominently from the project detail page.

### `infra-repos` static config

This config currently drives repo resolution for workspace creation and populates project/environment key options in dropdowns. After this correction:
- Workspace creation reads repo from DB (via project record)
- Dropdown options for workspace keys (`dev`, `prod`) can remain config-driven as a convenience or be derived from the project record
- Config can remain for bootstrapping projects in dev/staging

---

## 7. Routing / IA Recommendation

```
/projects                                    — list all projects (Create Project CTA)
/projects/new                                — create project form
/projects/[projectId]                        — project overview (workspaces, access, settings tabs)
/projects/[projectId]/workspaces             — workspace list (embedded in project detail)
/projects/[projectId]/workspaces/new         — create workspace (project pre-filled)
/projects/[projectId]/workspaces/[id]        — workspace detail
/projects/[projectId]/settings               — project metadata (name, repo, branch)
/projects/[projectId]/access                 — team and user role management
```

Routes already in place (`/projects`, `/projects/[projectId]`, `/projects/[projectId]/workspaces/new`, `/projects/[projectId]/workspaces/[id]`) require no changes. The additions are `/projects/new`, `/projects/[projectId]/settings`, and `/projects/[projectId]/access`.

---

## 8. UX Implications

### Correct onboarding flow

```
1. User arrives at /projects (empty state)
2. Clicks "Create project"
3. Fills in: name, project_key, repo, default_branch
4. Project is created → navigated to /projects/[projectId]
5. Empty workspaces state: "No workspaces yet. Create one."
6. Clicks "New Workspace" → /projects/[projectId]/workspaces/new
7. Selects template → fills in workspace key + slug
8. Workspace created → navigated to workspace detail
9. Deploys workspace → creates requests
```

### Access configuration flow

```
1. Project created (step 3–4 above)
2. Owner clicks "Access" tab on project detail
3. Assigns teams or individual users with roles (viewer/planner/operator/deployer/admin)
4. Team members can then access the project's workspaces
```

This flow is impossible today because step 1–4 (create project) does not exist.

---

## 9. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Half-switched IA** — project-first nav without project creation | **Current state. Active.** | This delta resolves it. |
| **Fake hierarchy in sidebar** — projects appear that users didn't consciously create | Medium | Once project creation exists, sidebar entries will correspond to intentional resources. Existing derived projects are valid data, not a correctness problem. |
| **infra-repos config dependency** | Medium | Phased: keep config for dev/seeding; route workspace creation through DB in production. Guard with feature flag if needed. |
| **project_key immutability** — key is used in routes and workspace records | Medium | `project_key` must be immutable post-creation (like a GitHub repo name). Enforce this in UI and API. The `UNIQUE(org_id, project_key)` constraint is already in place. |
| **Orphaned workspaces** — workspaces whose project_key has no matching project record | Low | Audit query: `SELECT DISTINCT project_key FROM workspaces WHERE project_key NOT IN (SELECT project_key FROM projects WHERE org_id = ...)`. Fix by inserting missing project records during migration if needed. |
| **Static config removal** — teams relying on config-seeded repo data | Low | The config is not used in production today for authoritative data. It is dev tooling. Decommission carefully. |

---

## 10. Recommendation

**Make Projects first-class resources. Implement now.**

The DB foundation is already in place. The workspace creation flow already requires a project to pre-exist. RBAC is already project-scoped. The only missing pieces are the user-facing creation path and routing `repo_full_name` through the DB rather than the static config.

Delaying this creates a compounding UX debt: every new user who encounters the platform will hit a navigation hierarchy that implies a flow the product does not support. The fix is narrowly scoped and resolves an active architectural inconsistency.

---

## 11. Execution Order (completed)

### Phase A — Project creation API ✅
- `createProject`, `updateProject`, `resolveProjectByIdOrKey` in `lib/db/projects.ts`
- `POST /api/projects`, `GET/PATCH /api/projects/[projectId]`
- Creator auto-assigned as project `admin`

### Phase B — Project creation UI ✅
- `/projects/new` creation form
- `/projects` empty state + "New Project" CTA (header + sidebar)

### Phase C — Workspace creation from projects table ✅
- `POST /api/workspaces` reads `repo_full_name`, `default_branch` from project record
- Static config no longer used for workspace creation

### Phase D — Project settings and access ✅
- `/projects/[projectId]/settings` — update name, repo, branch
- `/projects/[projectId]/access` — user/team role management
- Layout with Workspaces / Settings / Access tabs

### Phase E — Audit and cleanup ✅
- `listOrphanedWorkspaceProjectKeys(orgId?)` in `lib/db/projects.ts`
- `GET /api/admin/audit/workspaces-missing-project`

---

## Recommendation Summary

- **Adopt Option A: Projects become first-class, user-created resources.**
- The DB schema is already in place; the implementation gap is the creation API + UI and repo resolution through the DB.
- Workspace creation already enforces a project must pre-exist — complete the contract by making project creation explicit.
- `project_key` is immutable after creation; `repo_full_name` and `default_branch` become the project's canonical values for all workspace operations.
- The static `infra-repos` config is demoted to a dev/seeding convenience, not a runtime dependency.
- Execution is additive: no destructive migrations, no RBAC restructuring, no route changes to existing pages.
