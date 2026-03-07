# TfPilot RBAC Overhaul — Architecture Delta & Implementation Plan

**Status:** Draft  
**Date:** 2026-03-07  
**Scope:** Full RBAC redesign inspired by env0; execution architecture unchanged.

---

## 1. Problem Statement

TfPilot’s current authorization model is too limited compared to modern infrastructure platforms (e.g. env0, Terraform Cloud).

### Current Model

| Layer | Mechanism | Limitation |
|-------|-----------|------------|
| **Org roles** | `org_memberships.role` (viewer, developer, approver, admin) | Used for org management and project access short-circuit only |
| **Platform roles** | `getUserRole(login)` from TFPILOT_ADMINS / TFPILOT_APPROVERS | Global, env-based; not per-org or per-project |
| **Project access** | `project_team_access` (boolean) + team membership | No roles; access is all-or-nothing |
| **Teams** | `teams`, `team_memberships` | Teams exist but cannot carry project roles |

### Problems

1. **Project access is boolean** — Teams either have access or not; no planner vs deployer vs admin.
2. **Teams cannot carry roles** — A team grants the same level of access to all members.
3. **Users cannot have direct project roles** — Only via team membership or org admin.
4. **Effective permissions are hard-coded** — Logic scattered across routes; no single permission engine.
5. **UI cannot support env0-style management** — No Users/Teams tabs per project with role dropdowns.
6. **Dual role systems** — Login-based (`getUserRole`) vs org-based (`getUserOrgRole`) creates confusion.
7. **Legacy platform allowlists** — TFPILOT_ADMINS, TFPILOT_APPROVERS are env-based; everything should come from org_memberships and project_roles for a cleaner, predictable model.

---

## 2. Target RBAC Architecture

### Hierarchy (unchanged)

```
Organization
└── Projects
    └── Environments
```

### Authorization Scopes

| Scope | Purpose |
|-------|---------|
| **Organization** | Platform/org authority: manage members, teams, org settings |
| **Project** | Actions on infrastructure in that project: plan, approve, apply, destroy, manage access |

Environment scope is **out of scope** for this overhaul (optional future).

### Separation of Concerns

| Concern | Org Roles | Project Roles |
|---------|-----------|---------------|
| **What they control** | Org settings, members, teams, project access management | Request lifecycle, environment deploy/destroy |
| **Where assigned** | `org_memberships` | `project_user_roles`, `project_team_roles` |
| **Org admin short-circuit** | Org admin manages org | Org admin has full authority on all projects |

---

## 3. New Role Hierarchy

### Org Roles (unchanged conceptually)

| Role | Capabilities |
|------|--------------|
| **admin** | Manage members, teams, project access; full org authority; short-circuits to full project authority |
| **approver** | Approve requests (org-level gate); no automatic project authority |
| **viewer** | Read-only org access |
| **developer** | Create requests, trigger plan; no automatic project authority |

*Note: TfPilot currently uses `developer` in org_memberships; `approver`/`admin` come from both org and login allowlists. The overhaul unifies: org roles from DB only; project roles from new tables.*

### Project Roles (new)

| Role | Order | Plan | Approve | Apply | Destroy | Deploy Env | Manage Project Access |
|------|:-----:|:----:|:-------:|:-----:|:-------:|:----------:|:---------------------:|
| **viewer** | 0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **planner** | 1 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **operator** | 2 | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **deployer** | 3 | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| **admin** | 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

*Mapping to TfPilot actions: Plan = trigger plan; Approve = approve PR; Apply = merge + apply; Destroy = destroy request; Deploy Env = deploy/destroy environment; Manage = assign roles on project.*

### Deterministic Project Role Ordering

```
viewer < planner < operator < deployer < admin
```

Numeric rank for comparison: `viewer=0, planner=1, operator=2, deployer=3, admin=4`.

---

## 4. Effective Role Resolution Algorithm

### resolveEffectiveProjectRole(ctx, projectId)

**PermissionContext** (built once per request to avoid N+1):

```ts
type PermissionContext = {
  login: string
  orgId: string
  orgRole: OrgRole | null
  teamIds: string[]   // User's team IDs in this org — loaded once at request start
  projectRoleCache: Map<string, ProjectRole | null>  // Per-request cache: projectId → effective role
}
```

**Algorithm:**

```
0. Check cache: if ctx.projectRoleCache.has(projectId) → return ctx.projectRoleCache.get(projectId)

1. If ctx.orgRole === 'admin':
   → cache and return 'admin' (short-circuit)

2. Single query (no N+1):
   SELECT role FROM project_user_roles
     WHERE project_id = $1 AND user_login = $2
   UNION
   SELECT role FROM project_team_roles
     WHERE project_id = $1 AND team_id = ANY($3)

   ($3 = ctx.teamIds; empty array if no teams)

3. If no rows returned:
   → result = null (no project access)

4. Apply "highest role wins":
   → result = max(roles, by PROJECT_ROLE_ORDER)

5. ctx.projectRoleCache.set(projectId, result); return result
```

**Context construction:** At request start (middleware or first auth check), load `orgRole` and `teamIds` once; create empty `projectRoleCache`. Pass `ctx` into all permission helpers. First call per project hits DB; subsequent calls for same project use cache. Prevents repeated queries when a page checks permissions multiple times.

### PROJECT_ROLE_ORDER

```ts
const PROJECT_ROLE_ORDER: ProjectRole[] = ['viewer', 'planner', 'operator', 'deployer', 'admin']
const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, planner: 1, operator: 2, deployer: 3, admin: 4 }
```

### Permission Helpers (derive from effective role)

```
userCanView(user, project)     → effectiveRole !== null
userCanPlan(user, project)    → rank >= planner
userCanApprove(user, project)  → rank >= operator
userCanApply(user, project)    → rank >= operator
userCanDestroy(user, project)  → rank >= admin
userCanDeployEnv(user, project)→ rank >= deployer
userCanManageProjectAccess(user, project) → rank >= admin
```

---

## 5. Database Schema Changes

### New Tables

#### project_user_roles

```sql
CREATE TABLE project_user_roles (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_login TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','planner','operator','deployer','admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  PRIMARY KEY (project_id, user_login)
);

CREATE INDEX idx_project_user_roles_login ON project_user_roles(user_login);
```

#### project_team_roles (replaces project_team_access)

```sql
-- Migration: rename + add role column, or create new and migrate
CREATE TABLE project_team_roles (
  project_id TEXT NOT NULL REFERENCES projects(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  role TEXT NOT NULL CHECK (role IN ('viewer','planner','operator','deployer','admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  PRIMARY KEY (project_id, team_id)
);

CREATE INDEX idx_project_team_roles_team ON project_team_roles(team_id);
```

### Migration from project_team_access

- **Option A:** Add `role` column to `project_team_access`, default `'operator'` (or `'deployer'` to preserve current apply capability), then rename to `project_team_roles`.
- **Option B:** Create `project_team_roles`, migrate data with default role, drop `project_team_access`.

Recommended: **Option A** — single migration, minimal code churn.

### Schema Summary

| Table | Change |
|-------|--------|
| **project_user_roles** | NEW — direct user → project role |
| **project_team_access** | REPLACE → **project_team_roles** (add `role`, `granted_at`, `granted_by`) |
| **org_memberships** | Unchanged |
| **teams**, **team_memberships** | Unchanged |

---

## 6. Permission Resolver Design

### Module: `lib/auth/permissions.ts`

```ts
// Types
export type ProjectRole = 'viewer' | 'planner' | 'operator' | 'deployer' | 'admin'

export type PermissionContext = {
  login: string
  orgId: string
  orgRole: OrgRole | null
  teamIds: string[]   // User's team IDs in this org — loaded once at request start
  projectRoleCache: Map<string, ProjectRole | null>  // Per-request cache; prevents repeated DB queries
}

// Core resolver (checks cache first; single UNION query on cache miss; no N+1)
export async function resolveEffectiveProjectRole(
  ctx: PermissionContext,
  projectId: string
): Promise<ProjectRole | null>

// Action gates (replace inline checks)
export async function userCanPlan(ctx: PermissionContext, projectId: string): Promise<boolean>
export async function userCanApprove(ctx: PermissionContext, projectId: string): Promise<boolean>
export async function userCanApply(ctx: PermissionContext, projectId: string): Promise<boolean>
export async function userCanDestroy(ctx: PermissionContext, projectId: string): Promise<boolean>
export async function userCanDeployEnv(ctx: PermissionContext, projectId: string): Promise<boolean>
export async function userCanManageProjectAccess(ctx: PermissionContext, projectId: string): Promise<boolean>
```

### Integration with Existing Auth

- **Org role** from `getUserOrgRole(login, orgId)` → `org_memberships`.
- **Project role** from `resolveEffectiveProjectRole` → `project_user_roles` + `project_team_roles`.
- **Platform allowlists removed** — TFPILOT_ADMINS and TFPILOT_APPROVERS deleted. All role resolution comes from org_memberships and project_roles. Platform routes (list/create/archive orgs) to be gated by a new mechanism: e.g. `platform_admins` table or "org admin of designated platform org".
- **Prod allowlists** (TFPILOT_PROD_ALLOWED_USERS, TFPILOT_DESTROY_PROD_ALLOWED_USERS) — optional: keep as additional gate for prod environments, or migrate to project-level admin role.

### Deprecation Path

- `userHasProjectKeyAccess` → replaced by `resolveEffectiveProjectRole !== null` for "has any access".
- Route-level `getUserRole` + `userHasProjectKeyAccess` → replaced by `userCanX(ctx, projectId)`.

---

## 7. Required API Changes

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/org/projects/[projectId]/users` | List users with project roles (for Project Settings > Users) |
| GET | `/api/org/projects/[projectId]/teams` | List teams with project roles (for Project Settings > Teams) |
| PUT | `/api/org/projects/[projectId]/users/[login]` | Set/update user project role |
| DELETE | `/api/org/projects/[projectId]/users/[login]` | Remove user from project |
| PUT | `/api/org/projects/[projectId]/teams/[teamId]` | Set/update team project role |
| DELETE | `/api/org/projects/[projectId]/teams/[teamId]` | Remove team from project |

### Modified Endpoints

| Route | Change |
|-------|--------|
| `POST /api/requests` | Replace `userHasProjectKeyAccess` with `userCanPlan` |
| `POST /api/requests/[id]/approve` | Replace with `userCanApprove` |
| `POST /api/requests/[id]/apply` | Replace with `userCanApply` |
| `POST /api/requests/[id]/destroy` | Replace with `userCanDestroy` |
| `POST /api/environments/[id]/deploy` | Replace with `userCanDeployEnv` |
| `POST /api/environments/[id]/destroy` | Replace with `userCanDeployEnv` |
| `GET /api/org/teams/access` | Return `project_team_roles` with role per project (or extend) |
| `PUT /api/org/teams/access` | Accept `role` per team-project; write to `project_team_roles` |

### Org / Teams APIs

- `GET /api/org/members` — unchanged; may add `projectRoles` summary per member (optional).
- `GET /api/org/teams` — unchanged.
- `GET /api/org/teams/[teamId]/members` — unchanged.
- Team access APIs — extend to support role in request/response.

---

## 8. UI Architecture Changes

### Organization Settings (existing)

- **Members** — Org role dropdown (unchanged). Optional: show "Project roles" summary per user.
- **Teams** — Member avatar stack, count (unchanged). Add "Project roles" column or expandable section.

### New: Project Settings

**Location:** `/settings/projects/[projectKey]` or `/settings/org/projects/[projectId]` (depending on routing).

**Tabs:**

1. **General** — Project name, key, repo (if applicable).
2. **Users** — Table: avatar, display name, login, role dropdown, remove. Inline edit. Requires `userCanManageProjectAccess`.
3. **Teams** — Table: team name, member count, role dropdown, remove. Inline edit.

**Patterns (env0-style):**

- Assign user: select from org members list, pick role, save.
- Assign team: select from org teams list, pick role, save.
- Role dropdown: viewer, planner, operator, deployer, admin.
- Member avatar stack on Teams page.

### Teams Page Enhancement

- Per-team: show assigned projects with roles (e.g. "core (deployer), payments (viewer)").
- Link to project settings for editing.

### Members Page Enhancement

- Per-member: show project role assignments (e.g. "core: deployer, payments: viewer").
- Link to project settings.

### Request Detail / Environment Pages

- Replace `meData?.role === "admin"` with permission checks from `/api/auth/me` extended to include `projectRoles` or `canDestroy` per request.
- Or: `GET /api/requests/[id]/can-destroy` (existing) continues to work; ensure it uses new permission engine.

---

## 9. Migration Plan

### Phase 1: Schema + Permission Engine (no behavior change)

1. Add migration: `project_user_roles`, migrate `project_team_access` → `project_team_roles` with default role `operator`.
2. Implement `lib/auth/permissions.ts` with `resolveEffectiveProjectRole`, `userCanPlan`, etc.
3. Implement `lib/db/projectUserRoles.ts`, `lib/db/projectTeamRoles.ts`.
4. **Keep** existing `userHasProjectKeyAccess`; have it call new resolver under the hood (role !== null ⇒ access) for backward compatibility during rollout.

### Phase 2: API Wiring

1. Replace `userHasProjectKeyAccess` with `userCanPlan` / `userCanApprove` / `userCanApply` / `userCanDestroy` / `userCanDeployEnv` in each route.
2. Add new project access APIs (users, teams CRUD with roles).
3. Update `GET /api/org/teams/access` and `PUT /api/org/teams/access` to use `project_team_roles` and accept role.

### Phase 3: UI

1. Add Project Settings page with Users and Teams tabs.
2. Update Teams page to show project roles.
3. Update Members page to show project roles.
4. Update team access UI (e.g. teams page or project settings) to use role dropdown instead of checkbox.

### Phase 4: Cleanup

1. Remove `userHasProjectKeyAccess`; ensure all callers use permission helpers.
2. **Delete platform allowlists** — Remove TFPILOT_ADMINS, TFPILOT_APPROVERS from env config and `lib/auth/roles.ts`. Implement platform route gating via new mechanism (e.g. `platform_admins` table or org admin of designated org).
3. Update docs: RBAC.md, ORGANISATIONS.md, SYSTEM_OVERVIEW.md, env.example.

---

## 10. Test Strategy

### Unit Tests

- `resolveEffectiveProjectRole`: org admin short-circuit; direct user role; team roles; multiple teams (highest wins); no access.
- `userCanPlan`, `userCanApprove`, etc.: each role level.
- Edge cases: null login, invalid project, empty teams.

### Integration Tests

- API routes: apply, approve, destroy, deploy with various project roles.
- Project access APIs: assign/remove user, assign/remove team with role.
- Migration: existing `project_team_access` data produces correct effective roles.

### Invariant Tests

- Extend `tests/invariants/` or `tests/api/projectAccessEnforcementRoute.test.ts` to cover new permission matrix.
- Ensure org admin always has full project authority.

---

## 11. Implementation Phases (Summary)

| Phase | Scope | Duration (est.) |
|-------|-------|-----------------|
| **1** | Schema migration, permission engine, backward-compat `userHasProjectKeyAccess` | 2–3 days |
| **2** | API route updates, new project access APIs | 2–3 days |
| **3** | Project Settings UI, Teams/Members enhancements | 3–4 days |
| **4** | Cleanup, docs, tests | 1–2 days |

**Total:** ~8–12 days.

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking existing project access** | Migration gives all existing team-project links default role `operator` (plan + approve + apply). Verify with current behavior. |
| **Org role vs project role confusion** | Clear docs; org admin short-circuit is explicit. |
| **Performance: N+1 on permission checks** | PermissionContext includes `teamIds` (single load) and `projectRoleCache` (per-request). Resolver checks cache before querying; one DB hit per project per request max. |
| **Prod allowlists** | Optional: keep as additional gate; or migrate to project admin role for prod. |
| **Platform routes after allowlist removal** | TFPILOT_ADMINS deleted. Implement `platform_admins` table or "org admin of org X" for list/create/archive orgs. |
| **Single source of truth** | All roles from org_memberships + project_user_roles + project_team_roles. Cleaner, more predictable. |

---

## Appendix A: Permission Matrix (Target)

| Action | viewer | planner | operator | deployer | admin |
|--------|:-----:|:-------:|:--------:|:--------:|:-----:|
| View project/requests | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create request | ✗ | ✓ | ✓ | ✓ | ✓ |
| Trigger plan | ✗ | ✓ | ✓ | ✓ | ✓ |
| Approve request | ✗ | ✗ | ✓ | ✓ | ✓ |
| Apply (merge + run) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Destroy request | ✗ | ✗ | ✗ | ✗ | ✓ |
| Deploy environment | ✗ | ✗ | ✗ | ✓ | ✓ |
| Destroy environment | ✗ | ✗ | ✗ | ✓ | ✓ |
| Manage project access | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## Appendix B: Files to Touch

| Area | Files |
|------|-------|
| **Migrations** | New migration for `project_user_roles`, `project_team_roles` |
| **Permission engine** | `lib/auth/permissions.ts` (new), `lib/auth/projectAccess.ts` (deprecate/refactor), `lib/auth/roles.ts` (remove getUserRole / TFPILOT_* usage) |
| **DB layer** | `lib/db/projectUserRoles.ts`, `lib/db/projectTeamRoles.ts`, `lib/db/projectTeamAccess.ts` (remove or repurpose) |
| **API routes** | `app/api/requests/route.ts`, `app/api/requests/[requestId]/approve/route.ts`, `app/api/requests/[requestId]/apply/route.ts`, `app/api/requests/[requestId]/destroy/route.ts`, `app/api/environments/[id]/deploy/route.ts`, `app/api/environments/[id]/destroy/route.ts`, `app/api/org/teams/access/route.ts` |
| **New APIs** | `app/api/org/projects/[projectId]/users/route.ts`, `app/api/org/projects/[projectId]/teams/route.ts` |
| **UI** | `app/settings/org/page.tsx`, `app/settings/teams/page.tsx`, new `app/settings/projects/[projectId]/page.tsx` |
| **Config** | `lib/config/env.ts` (remove TFPILOT_ADMINS, TFPILOT_APPROVERS), `env.example` |
| **Docs** | `docs/RBAC.md`, `docs/ORGANISATIONS.md`, `docs/SYSTEM_OVERVIEW.md` |
