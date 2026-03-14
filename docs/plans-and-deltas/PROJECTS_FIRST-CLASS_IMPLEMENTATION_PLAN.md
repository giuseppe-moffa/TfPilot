Implementation plan — Projects first-class

**Status: Implemented** (Phases A–E completed 2026-03)

The delta defines five phases (A–E). Summary of what was implemented:

Phase A — Project creation API (backend) ✅
Role: backend-api-agent

Files:

lib/db/projects.ts — add createProject(...) function
app/api/projects/route.ts — add POST handler (validate uniqueness, auto-assign creator as admin, return created project)
app/api/projects/[projectId]/route.ts — new: GET single project detail
Impact: additive only. No existing routes changed. UNIQUE(org_id, project_key) constraint already in DB. Risk: low Rollback: delete the new routes — no schema change required.

Phase B — Project creation UI + empty state fix (frontend) ✅
Role: frontend-builder-agent

Files:

app/projects/new/page.tsx — new: 3-field creation form (name, project_key, repo, branch)
app/projects/page.tsx — update empty state + add "New Project" CTA
components/layout/AppShell.tsx — add "New Project" child under Projects group in sidebar
Impact: UI only. No API contract changes. Risk: low Rollback: revert page files.

Phase C — Workspace creation reads from projects table (backend) ✅
Role: backend-api-agent

Files:

app/api/workspaces/route.ts — remove resolveInfraRepoByProjectAndEnvKey; read repo_full_name and default_branch from the project record returned by getProjectByKey
Impact: breaks workspace creation if project record has no repo_full_name. Must confirm existing project rows have this column populated (they do — the migration 20260320001000_projects.sql includes repo_full_name NOT NULL). Risk: medium — must audit existing project rows before deploying Rollback: restore resolveInfraRepoByProjectAndEnvKey call.

Phase D — Project settings + access pages (frontend) ✅
Role: frontend-builder-agent

Files:

app/projects/[projectId]/settings/page.tsx — new: update name, repo, branch
app/projects/[projectId]/access/page.tsx — new: team/user role management (reuses existing AssignTeamProjectDialog and TeamProjectAssignments components)
app/api/projects/[projectId]/route.ts — add PATCH handler (update name, repo, branch)
app/projects/[projectId]/page.tsx — add Settings/Access tabs
Impact: additive. No RBAC model changes. Risk: low Rollback: revert new pages.

Phase E — Audit and cleanup (backend) ✅
Role: backend-api-agent

Files:

app/api/admin/audit/workspaces-missing-project/route.ts — new audit route for workspaces with no matching project
lib/db/projects.ts — listOrphanedWorkspaceProjectKeys(orgId?) helper
Impact: read-only audit. No data modification. Risk: low

---

## Approval gate (historical)
Before I start Phase A, confirm:

Phase A scope confirmed — add createProject to lib/db/projects.ts, add POST /api/projects, add GET /api/projects/[projectId]
Auto-assign creator as admin — yes? (this uses existing upsertProjectUserRole in lib/db/projectRoles.ts)
Phase C sequencing — should Phase C (removing static config dependency) run immediately after B, or after D when settings UI is in place so users can fix any project records missing repo_full_name?
Phases A → B → C → D → E in that order makes the whole flow work correctly. Just need your sign-off before I start.