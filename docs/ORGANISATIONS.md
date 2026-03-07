# Organisations

Organisation (org) tenancy, membership, teams, and project access in TfPilot.

---

## Overview

- **Orgs** are the top-level tenancy unit. All environments, requests, projects, and teams are scoped to an org.
- **Members** are identified by GitHub login. Membership is stored in `org_memberships` (org_id, login, role).
- **Org roles:** `viewer`, `developer`, `approver`, `admin`. Only org `admin` can manage members, teams, and project access.
- **Platform admins:** `platform_admins` table. Platform-wide org lifecycle (list/create/archive/restore). See [RBAC.md](RBAC.md).
- **Session:** The active org is stored in the session cookie (`orgId`, `orgSlug`). Org-scoped APIs use `session.orgId` only; never from client.

---

## Project access

Access to projects (and thus environments and requests) is enforced via the permission engine (`requireRequestProjectPermission`, `buildPermissionContext`):

1. **Org admin** — Full access to all projects in the org (short-circuits to project admin).
2. **Team membership** — User must be in at least one team that has `project_team_access` to the project.

Projects are stored in `projects` (org_id, project_key, name). Team→project grants are in `project_team_access`. All request lifecycle and environment APIs (create, deploy, destroy, apply, approve) check both org/project roles and project access. Cross-org: `resource.org_id` must match `session.orgId`; otherwise 404.

---

## Add member (membership write)

**UI:** Org Settings → Members → "Add member" form (GitHub login + role).

**Behavior:** This is a **membership write flow**, not a true invite flow.

- Adds or updates membership by GitHub login.
- **Does not verify** that the GitHub account exists.
- **Does not send** email or notification.
- **Upserts:** If the login is already in the org, the role is updated.

**API:** `POST /api/org/members` with `{ login, role }`. Requires org-admin. Uses `session.orgId`.

**After add:** The user can sign in with that GitHub account and will see the org (if they have at least one membership). No separate accept/join step.

---

## Member management (org-admin only)

- **Change role:** PATCH `/api/org/members` with `{ login, role }`. Last-admin protection: cannot demote the last org admin.
- **Remove member:** DELETE `/api/org/members` with `{ login }`. Last-admin protection: cannot remove the last org admin.

---

## Teams

**UI:** Org Settings → Teams.

**Behavior:**

- **Create team:** POST `/api/org/teams` with `{ slug, name }`. Org-admin only.
- **Add member to team:** POST `/api/org/teams/[teamId]/members` with `{ login }`. Org-admin only.
- **Remove member from team:** DELETE `/api/org/teams/[teamId]/members` with `{ login }`. Org-admin only.
- **Grant team access to project:** POST `/api/org/teams/access` with `{ teamId, projectId }`. Org-admin only.
- **Revoke team access:** DELETE `/api/org/teams/access` with `{ teamId, projectId }`. Org-admin only.

Teams are org-scoped. `project_team_access` links teams to projects; users in a team gain access to that project (unless they are org admin, in which case they already have full access).

---

## Org switcher

Users who belong to multiple orgs see a compact org switcher in the header. Switching updates the session cookie and refreshes the app. `orgSlug` comes from the DB only, never from the client.

- **GET /api/auth/orgs** — Returns orgs the user belongs to. Archived orgs are excluded.
- **POST /api/auth/switch-org** — Body: `{ orgId }`. Rejects archived org (400 "Cannot switch to archived org"). Updates session with orgId/orgSlug from DB.

---

## Org lifecycle (platform-admin only)

Platform admins (`platform_admins` table, `isPlatformAdmin(login)`) manage org lifecycle via `/api/platform/orgs` and `/settings/platform/orgs`:

- **Create:** POST `/api/platform/orgs` — Body: `slug`, `name`, `adminLogin`. Creates org + initial admin membership atomically. Duplicate slug → 400.
- **Archive:** POST `/api/platform/orgs/[orgId]/archive` — Sets `archived_at = NOW()`. Idempotent.
- **Restore:** POST `/api/platform/orgs/[orgId]/restore` — Clears `archived_at`. Idempotent.
- **Detail:** GET `/api/platform/orgs/[orgId]` — Returns org, members, teams, stats. Archived orgs are still visible to platform admin.

### Archived organization runtime enforcement

When `session.orgId` points to an **archived org**, org-scoped APIs return **403** `{ error: "Organization archived" }`. Guard: `requireActiveOrg(session)` in `lib/auth/requireActiveOrg.ts`.

- **Exclusions:** Archived orgs excluded from `GET /api/auth/orgs`. `POST /api/auth/switch-org` rejects switching to archived org.
- **Platform admin bypass:** Platform routes do not use `requireActiveOrg`. Platform admins can list, view, archive, and restore orgs even when their current session org is archived.

---

## Future: true invite flow (not implemented)

A real invite flow would add:

- Pending invite state
- Accept/join flow
- Optional GitHub existence validation
- Optional notification/email

Current model is additive membership by login.

---

## See also

- [RBAC.md](RBAC.md) — Platform roles, permissions, allowlists
- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — Architecture and data model
