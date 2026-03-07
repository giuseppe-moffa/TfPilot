# TfPilot Role-Based Access Control (RBAC)

This document describes how roles, permissions, and allowlists control access across the TfPilot platform.

---

## Overview

TfPilot uses multiple authorization layers:

1. **Org roles** — `org_memberships.role` (viewer, developer, approver, admin). Per-org; gates request lifecycle actions. Resolved via `getUserOrgRole(login, orgId)`.
2. **Platform admin** — `platform_admins` table. Platform-wide: list/create/archive/restore orgs; view any org detail; bypass archived-org enforcement on platform routes. Check via `isPlatformAdmin(login)`.
3. **Org admin** — `org_memberships.role === "admin"`. Per-org: manage members, teams, project access. Short-circuits to full project authority.
4. **Project roles** — `project_user_roles` and `project_team_roles`. Per-project permissions (viewer, planner, operator, deployer, admin). Required for request lifecycle actions. Org admin bypasses.
5. **Admin-by-email** — `requireAdminByEmail()` checks `TFPILOT_ADMIN_EMAILS`. Used for catalogue/template admin UI and Insights.

### Dual permission model: RBAC + project access

| Check | What it gates | Example |
|-------|---------------|---------|
| **RBAC (role)** | *What* action is allowed | Approve requires approver/admin; Deploy/Destroy require admin |
| **Project access** | *Which* project the user may operate on | User must be org admin or in a team with access to the project |

Both must pass. A developer with project access can create requests; an approver with project access can approve; an admin with project access can deploy/destroy. Without project access → 404.

| Mechanism              | Identity          | Config               | Use case                           |
|------------------------|-------------------|----------------------|------------------------------------|
| Org role               | `session.login` + org | `org_memberships` | Request lifecycle, environments (org-scoped) |
| Platform admin         | `session.login`   | `platform_admins` table | Platform org management (/api/platform/orgs) |
| Project role           | org/team + project | `project_user_roles`, `project_team_roles`, org admin | Per-project permissions (plan, approve, apply, destroy) |
| Admin-by-email        | `session.email`   | `TFPILOT_ADMIN_EMAILS` | Catalogue, request templates, Insights |

---

## Org roles

Defined in **org_memberships** table. Resolved via `getUserOrgRole(login, orgId)` in `lib/auth/orgRoles.ts`.

| Role        | Description                                      |
|-------------|--------------------------------------------------|
| **viewer**  | Read-only. Cannot create, update, approve, deploy, or destroy. |
| **developer** | Create requests, update config, trigger plan. Cannot approve, merge, apply, deploy, or destroy. |
| **approver** | Developer permissions + approve PRs, merge, apply. |
| **admin**   | Full org access including environment deploy and destroy. Org admin short-circuits to full project authority. |

## Project roles

Defined in **project_user_roles** and **project_team_roles**. Resolved via `resolveEffectiveProjectRole` in `lib/auth/projectRoles.ts`. Org admin bypasses (treated as project admin).

| Role        | plan | approve | apply | destroy | deploy_env |
|-------------|:----:|:-------:|:-----:|:-------:|:----------:|
| viewer      | ✗    | ✗       | ✗     | ✗       | ✗          |
| planner     | ✓    | ✗       | ✗     | ✗       | ✗          |
| operator    | ✓    | ✓       | ✓     | ✗       | ✗          |
| deployer    | ✓    | ✓       | ✓     | ✗       | ✓          |
| admin       | ✓    | ✓       | ✓     | ✓       | ✓          |

---

## Environment variables

| Variable                         | Type   | Purpose                                                                 |
|---------------------------------|--------|-------------------------------------------------------------------------|
| `TFPILOT_ADMIN_EMAILS`          | CSV    | Emails with access to catalogue admin, request templates admin, Insights. Requires `user:email` scope. |

**Platform admins:** Stored in `platform_admins` table. Seed via `npm run db:seed-platform-admins`. Optional env `TFPILOT_ADMINS` (CSV) for initial seed only; not used at runtime.

---

## Permission matrix

### Request lifecycle

| Action                         | viewer | developer | approver | admin |
|--------------------------------|:-----:|:---------:|:--------:|:-----:|
| List requests                  | ✓     | ✓         | ✓        | ✓     |
| View request detail            | ✓     | ✓         | ✓        | ✓     |
| Create request                 | ✗     | ✓         | ✓        | ✓     |
| Update request config          | ✗     | ✓         | ✓        | ✓     |
| Trigger plan                   | ✗     | ✓         | ✓        | ✓     |
| Approve request                | ✗     | ✗         | ✓        | ✓     |
| Merge PR                       | ✗     | ✗         | ✓*       | ✓*    |
| Apply                          | ✗     | ✗         | ✓*       | ✓*    |
| Destroy request                | ✗     | ✗         | ✗        | ✓**   |
| Update branch                  | ✗     | ✗         | ✓*       | ✓*    |

Prod access is gated by project roles (operator/deployer/admin); no separate prod allowlists.

### Environments

| Action                   | viewer | developer | approver | admin |
|--------------------------|:-----:|:---------:|:--------:|:-----:|
| List environments        | ✓     | ✓         | ✓        | ✓     |
| Create environment       | ✗     | ✓         | ✓        | ✓     |
| Deploy environment       | ✗     | ✗         | ✗        | ✓     |
| Destroy environment      | ✗     | ✗         | ✗        | ✓     |

### Admin-by-email features

| Resource                  | Gated by `TFPILOT_ADMIN_EMAILS` |
|---------------------------|----------------------------------|
| `/insights` page          | ✓                                 |
| Request templates admin   | ✓ (GET/POST/DELETE /api/request-templates/admin/**) |
| Catalogue admin UI        | ✓ (via template admin API)        |
| Template seed             | ✓                                 |

---

## API enforcement

| Route / Area                 | Role check                  | Notes |
|-----------------------------|-----------------------------|-------|
| `POST /api/requests`        | `viewer` blocked            | Create request |
| `PATCH /api/requests/update`| `viewer` blocked            | Update config |
| `POST /api/environments`    | `viewer` blocked            | Create environment |
| `POST /api/environments/:id/deploy` | `admin` only        | Deploy environment |
| `POST /api/environments/:id/destroy` | `admin` only        | Destroy environment |
| `POST /api/requests/:id/approve` | `approver` or `admin` | Approve PR |
| `POST /api/github/plan`     | —                           | Prod: `TFPILOT_PROD_ALLOWED_USERS` |
| `POST /api/github/apply`    | `approver` or `admin`       | Prod: `TFPILOT_PROD_ALLOWED_USERS` |
| `POST /api/github/merge`    | `approver` or `admin`       | Prod: `TFPILOT_PROD_ALLOWED_USERS` |
| `POST /api/github/update-branch` | `approver` or `admin` | Prod: `TFPILOT_PROD_ALLOWED_USERS` |
| `POST /api/requests/:id/destroy` | `admin` only        | Prod: `TFPILOT_DESTROY_PROD_ALLOWED_USERS` |
| `GET /api/requests/:id/can-destroy` | `admin` only   | Prod: `TFPILOT_DESTROY_PROD_ALLOWED_USERS` |
| `/api/request-templates/admin/**` | `requireAdminByEmail` | 404 for non-admins |
| `/api/platform/orgs/**` | Platform admin only | 404 for non-admins (same as org-not-found) |
| `/insights` page           | Server: `TFPILOT_ADMIN_EMAILS` | `notFound()` for non-admins |

---

## Prod allowlists

When `request.environment_key === "prod"` (case-insensitive):

1. **Plan / Apply / Merge / Update branch**
   - If `TFPILOT_PROD_ALLOWED_USERS` is non-empty, user must be in the list.
   - 403 otherwise.

2. **Destroy**
   - Admin role required.
   - If `TFPILOT_DESTROY_PROD_ALLOWED_USERS` is non-empty, user must also be in the list.
   - `GET /api/requests/:id/can-destroy` returns `canDestroy: false` with `reason: "not_in_destroy_prod_allowlist"` if missing.

---

## Login allowlist

- **`TFPILOT_ALLOWED_LOGINS`** (empty = allow any)
  - If non-empty, only listed GitHub logins can complete OAuth sign-in.
  - Rejected users are redirected to `/login?error=not_allowed`.
  - Enforced in `app/api/auth/github/callback/route.ts`.

---

## UI integration

- **`GET /api/auth/me`** — Returns `{ authenticated, user, role }`. Used by UI for `isAdmin` checks (e.g. destroy button visibility).
- **Request detail page** — Uses `meData?.role === "admin"` to show/hide destroy controls.
- **Insights / Catalogue** — Server-side gated by `TFPILOT_ADMIN_EMAILS`; non-admins get 404.

---

## Code references

| Component           | Path / file                                  |
|---------------------|-----------------------------------------------|
| Role resolution     | `lib/auth/roles.ts` — `getUserRole(login)`    |
| Admin-by-email      | `lib/auth/admin.ts` — `requireAdminByEmail()` |
| Session             | `lib/auth/session.ts` — `getSessionFromCookies()` |
| Auth me endpoint    | `app/api/auth/me/route.ts`                    |
| Env config          | `lib/config/env.ts`                           |

---

## Security notes

- **Defense in depth:** API routes enforce role and allowlist checks. UI hiding is for UX only; never trust client-side checks for access control.
- **Email scope:** `TFPILOT_ADMIN_EMAILS` requires GitHub OAuth `user:email` scope. Users may need to re-authorize if scope was added later.
- **Allowlist precedence:** For roles, `TFPILOT_ADMINS` overrides `TFPILOT_APPROVERS`. Same login in both → admin.

---

## See also

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — Architecture and components
- [OPERATIONS.md](OPERATIONS.md) — Recovery and common failures (e.g. 403 Insufficient role)
- [env.example](../env.example) — All RBAC-related env vars
