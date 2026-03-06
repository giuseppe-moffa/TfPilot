# Organisations

Organisation (org) tenancy, membership, and settings in TfPilot.

---

## Overview

- **Orgs** are the top-level tenancy unit. All environments, requests, and resources are scoped to an org.
- **Members** are identified by GitHub login. Membership is stored in `org_memberships` (org_id, login, role).
- **Roles:** `viewer`, `developer`, `approver`, `admin`. Only `admin` can manage members and org settings.
- **Session:** The active org is stored in the session cookie (`orgId`, `orgSlug`). Org-scoped APIs use `session.orgId` only; never from client.

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

## Org switcher

Users who belong to multiple orgs see a compact org switcher in the header. Switching updates the session cookie and refreshes the app. `orgSlug` comes from the DB only, never from the client.

---

## Future: true invite flow (not implemented)

A real invite flow would add:

- Pending invite state
- Accept/join flow
- Optional GitHub existence validation
- Optional notification/email

Not needed before Teams. Current model is additive membership by login.
