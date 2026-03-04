# TfPilot Role-Based Access Control (RBAC)

This document describes how roles, permissions, and allowlists control access across the TfPilot platform.

---

## Overview

TfPilot uses two parallel authorization mechanisms:

1. **Role-based access (GitHub login)** — `getUserRole(login)` assigns one of four roles from env allowlists. Roles gate request lifecycle actions (create, update, approve, deploy, destroy).
2. **Admin-by-email** — `requireAdminByEmail()` checks `TFPILOT_ADMIN_EMAILS`. Used for catalogue/template admin UI and Insights.

| Mechanism              | Identity          | Config               | Use case                           |
|------------------------|-------------------|----------------------|------------------------------------|
| Role (login)           | `session.login`   | `TFPILOT_ADMINS`, `TFPILOT_APPROVERS` | Request lifecycle, environments, destroy |
| Admin-by-email        | `session.email`   | `TFPILOT_ADMIN_EMAILS` | Catalogue, request templates, Insights |

---

## Roles (login-based)

Defined in **lib/auth/roles.ts**. Role resolution order:

1. No login → `viewer`
2. In `TFPILOT_ADMINS` → `admin`
3. In `TFPILOT_APPROVERS` → `approver`
4. Otherwise → `developer`

| Role        | Description                                      |
|-------------|--------------------------------------------------|
| **viewer**  | Read-only. Cannot create, update, approve, deploy, or destroy. |
| **developer** | Create requests, update config, trigger plan. Cannot approve, merge, apply, deploy, or destroy. |
| **approver** | Developer permissions + approve PRs, merge, apply. Prod actions may require prod allowlists. |
| **admin**   | Full platform access including environment deploy and destroy. |

---

## Environment variables

| Variable                         | Type   | Purpose                                                                 |
|---------------------------------|--------|-------------------------------------------------------------------------|
| `TFPILOT_ALLOWED_LOGINS`        | CSV    | GitHub logins allowed to sign in. Empty = allow any authenticated user. |
| `TFPILOT_ADMINS`                | CSV    | GitHub logins with `admin` role.                                       |
| `TFPILOT_APPROVERS`             | CSV    | GitHub logins with `approver` role (not in TFPILOT_ADMINS).             |
| `TFPILOT_PROD_ALLOWED_USERS`    | CSV    | Who can run plan/apply/merge on **prod** environments. Empty = any approver/admin. |
| `TFPILOT_DESTROY_PROD_ALLOWED_USERS` | CSV | Who can destroy **prod** resources. Additional check beyond admin role. Empty = any admin. |
| `TFPILOT_ADMIN_EMAILS`          | CSV    | Emails with access to catalogue admin, request templates admin, Insights. Requires `user:email` scope. |

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

\* On **prod** environments: requires `TFPILOT_PROD_ALLOWED_USERS` if configured.  
\** On **prod**: additionally requires `TFPILOT_DESTROY_PROD_ALLOWED_USERS` if configured.

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
