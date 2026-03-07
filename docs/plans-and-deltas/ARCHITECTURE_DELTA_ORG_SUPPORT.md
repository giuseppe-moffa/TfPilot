# ARCHITECTURE_DELTA_ORG_SUPPORT

## Status
Proposed

---

# Goal

Introduce **Org** as a first-class tenant boundary in TfPilot so that users, roles, projects, environments, requests, templates, and operator views are scoped to an organization.

This builds on the current GitHub OAuth session model and replaces the current global platform scope with an **org-scoped control plane**.

Core platform architecture must remain unchanged:

- S3 request documents remain authoritative
- Postgres remains a projection/index layer
- Lifecycle is derived from facts only
- Terraform execution happens only in GitHub Actions
- Environment deploy detection remains facts-based

---

# Scope

## In scope

1. Org tables + seed `default` org
2. Org membership + session org resolution
3. Org-scoped reads for
   - requests
   - environments
   - catalogue
   - insights
4. Org-scoped writes for
   - create request
   - create environment
   - create template
5. Small org badge near the user in the app shell
6. Foundation for later
   - org switcher
   - org settings page

## Out of scope

- SSO / SAML / OIDC
- org switcher UI
- org settings UI
- billing / quotas
- cross-org sharing
- policy engines
- legacy compatibility

---

# Greenfield assumption

This change assumes:

- no meaningful existing S3 data
- no meaningful Postgres data
- no need for legacy compatibility

Therefore:

- legacy global logic can be removed where it simplifies the design
- migrations do not require backfill or compatibility shims

---

# Why

TfPilot currently has:

- GitHub OAuth session
- global roles
- global project configuration
- global request/environment visibility
- global templates
- global insights

This works for a **single tenant internal platform** but does not support enterprise multi-tenancy.

The missing domain concept is **Org**.

Org must become the **hard tenancy boundary**.

---

# Target architecture

## Core tenancy model

Every tenant-owned object belongs to exactly one org.

Tenant-owned objects:

- projects
- environments
- requests
- request templates
- environment templates
- insights metrics

User access is determined by:

- GitHub identity
- org membership
- org role

---

# Admin model

Org creation is enterprise friendly.

Flow:

1. platform admin creates org
2. platform admin invites GitHub logins
3. invited users log in with GitHub OAuth
4. session resolves org membership

---

# Routing model

Routes remain unchanged for MVP:

/requests  
/environments  
/catalogue  
/insights  

Org context is derived from **session**, not URL.

Later phases may introduce `/org/:slug/...` but this is **not required for MVP**.

---

# Architecture changes

## 1. Org domain

### Table: orgs

Purpose: canonical tenant record.

Fields

org_id TEXT PRIMARY KEY  
slug TEXT UNIQUE NOT NULL  
name TEXT NOT NULL  
created_at TIMESTAMPTZ NOT NULL  
updated_at TIMESTAMPTZ NOT NULL  

---

### Table: org_memberships

Purpose: map GitHub login to org.

org_id TEXT NOT NULL  
login TEXT NOT NULL  
role TEXT NOT NULL  
created_at TIMESTAMPTZ NOT NULL  

PRIMARY KEY (org_id, login)

Allowed roles

viewer  
developer  
approver  
admin  

---

### Seed

During system initialization:

org_id = "default"  
slug = "default"  
name = "Default Org"

---

## 2. Org scoped session

### Current state

Session contains only user identity:

login  
name  
avatarUrl  
email  

No org context.

---

### New session payload

SessionPayload {
login
name
avatarUrl
email
orgId
orgSlug
}

**Do NOT store orgRole in session.** Storing role in the cookie creates stale permissions risk (e.g. user demoted to viewer, old cookie still says admin). Role must be resolved server-side on each request via `getUserOrgRole(login, orgId)`. This is how env0, Spacelift, and GitHub avoid stale authorization.

---

### OAuth login flow

New login sequence

1. GitHub OAuth completes
2. fetch GitHub user
3. lookup org membership by login
4. resolve current org
5. attach orgId + orgSlug to session
6. create session cookie

**If user has no org membership → 403.** Do not automatically assign to default org. Platform admins must invite users. This matches the enterprise admin model.

---

## 3. Org scoped RBAC

Authorization becomes:

identity = session.login  
org = session.orgId  
role = getUserOrgRole(login, orgId)  // resolved server-side from org_memberships; never from session

All authorization decisions must use org-scoped role resolved at request time.

---

## 4. Org scoped projects

**Replace `config/infra-repos.ts`** — the only true architecture violation in the system. Introduce projects table:

project_id TEXT PRIMARY KEY  
org_id TEXT NOT NULL  
project_key TEXT NOT NULL  
name TEXT NOT NULL  
repo_full_name TEXT NOT NULL  
default_branch TEXT NOT NULL  
created_at TIMESTAMPTZ NOT NULL  
updated_at TIMESTAMPTZ NOT NULL  

UNIQUE (org_id, project_key)

Rule: project_key is unique per org. Resolve repo using org context from this table.

---

## 5. Org scoped environments

Add org_id to environments.

Rules:

- environment belongs to exactly one org
- create attaches org_id from session
- reads verify ownership
- deploy/destroy verify ownership

---

## 6. Org scoped requests

Request documents include org_id.

Requests index also includes org_id.

Rules:

- request belongs to exactly one org
- list filters by org
- detail verifies ownership
- create sets org_id from session

---

## 7. Org scoped templates

**Prefix strategy only.** No global template index.

Request templates

request-templates/<org_id>/index.json  
request-templates/<org_id>/<templateId>.json  

Environment templates

environment-templates/<org_id>/index.json  
environment-templates/<org_id>/<templateId>.json  

Reasons: prevents accidental leakage, faster lookup, avoids global index scan, easier backup/export.

---

## 8. Org scoped insights

Insights metrics must aggregate only org data. **Use Postgres index, not S3.** S3 `listRequests` is expensive.

SELECT * FROM requests_index WHERE org_id = ?

Then aggregate metrics. **Fail-closed:** If session has no orgId, return 403 — never return global data.

---

## 9. UI change

Add org badge near user avatar in the app shell.

Example:

[user avatar] username [org badge] sign out

---

# Read path changes

Requests

GET /api/requests must filter by org_id.

GET /api/requests/:id must verify request.org_id equals session.orgId.

Environments

GET /api/environments must filter by org_id.

GET /api/environments/:id must verify ownership.

GET /api/environments/:id/activity — verify environment.org_id === session.orgId before querying activity timeline.

Catalogue

Templates loaded from org prefix only.

Insights

Metrics endpoints require org context and filter by org_id. **Fail-closed:** 403 if no session.orgId.

---

# Write path changes

Create request

- attach org_id from session
- verify environment and project belong to same org

Create environment

- attach org_id from session

Template CRUD

- write to org prefixed storage

Deploy / destroy

- verify resource.org_id equals session.orgId

---

# New invariants

INV-ORG-1  
Request belongs to exactly one org.

INV-ORG-2  
Environment belongs to exactly one org.

INV-ORG-3  
Project belongs to exactly one org.

INV-ORG-4  
All list endpoints filter by org.

INV-ORG-5  
All resource endpoints verify org ownership.

INV-ORG-6  
Create operations set org_id from session.

INV-ORG-7  
Postgres remains projection only.

INV-ORG-8  
Org context must fail closed.

INV-ORG-9  
Insights endpoints MUST fail closed if org context missing.

---

# Phased rollout

Phase 1  
Org tables, membership tables, seed default org, session org resolution.

Phase 2  
Projects table, environments.org_id, requests_index.org_id, request doc org_id.

Phase 3  
Scope reads for requests, environments, catalogue, insights.

Phase 4  
Scope writes for create request, create environment, template CRUD.

Phase 5  
UI org badge.

Later  
Org switcher, org settings page, invite management, SSO, governance.
