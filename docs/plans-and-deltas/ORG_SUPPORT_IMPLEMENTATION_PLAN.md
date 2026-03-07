# ORG_SUPPORT_IMPLEMENTATION_PLAN

## Purpose
Safe, incremental implementation plan for adding **Org (tenant) support** to TfPilot according to `docs/plans-and-deltas/ARCHITECTURE_DELTA_ORG_SUPPORT.md`.

Goals:
- Introduce org tenancy without breaking existing invariants
- Maintain S3 as authoritative for request lifecycle
- Maintain Postgres as projection/index only
- Ensure all endpoints fail closed without org context
- Implement in small verifiable steps

Core invariants preserved:
- Terraform runs only in GitHub Actions
- Lifecycle derived from request facts
- Postgres contains no lifecycle truth
- Org scoping enforced on all reads and writes


---

# Phase 1 — Org Foundation

## Step 1.1 Create org tables

Create migration:

```
migrations/20260320000000_orgs.sql
```

Tables:

```
orgs
org_memberships
```

Schema:

```sql
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE org_memberships (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  login TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, login)
);
```


---

## Step 1.2 Seed default org

Seed script executed on migration or bootstrap.

Create:

```
id = "default"
slug = "default"
name = "Default Org"
```

Seed memberships:

```
TFPILOT_ADMINS → admin
TFPILOT_APPROVERS → approver
```

Developers can be seeded manually or via script.


---

## Step 1.3 Implement org role resolver

Create:

```
lib/auth/orgRoles.ts
```

Function:

```
getUserOrgRole(login, orgId)
```

Behavior:

- query `org_memberships`
- return role
- return null if no membership


---

## Step 1.4 Extend session payload

Modify:

```
lib/auth/session.ts
```

New session fields:

```
orgId
orgSlug
```

Important rule:

```
Do NOT store orgRole in session.
```

Role must be resolved per request.


---

## Step 1.5 Resolve org during login

Modify:

```
app/api/auth/github/callback/route.ts
```

After OAuth login:

1. lookup membership for login
2. resolve org
3. attach orgId + orgSlug to session
4. encode session cookie

Failure rule:

```
If no membership → 403
```


---

# Phase 2 — Domain Model Changes

## Step 2.1 Add projects table

Migration:

```
migrations/20260320001000_projects.sql
```

Schema:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, project_key)
);
```


---

## Step 2.2 Replace global project registry

Remove:

```
config/infra-repos.ts
```

Introduce resolver:

```
lib/projects/getProjectRepo.ts
```

**Return full project/repo config shape, not just repo name.** The existing `resolveInfraRepo` returns `{ owner, repo, base, envPath }`. The replacement abstraction must return the equivalent full shape. Projects need more than `repo_full_name` — the resolver also needs env-specific data (branch/base, env path behavior).

Projects table must support:

- `repo_full_name` (or `repo_owner` + `repo_name`)
- `default_branch` (base)
- Env-specific `envPath` derivation (e.g. `envs/<environment_key>/` for Model 2)

Resolver signature:

```
getProjectRepo(orgId, projectKey, environmentKey) → { owner, repo, base, envPath }
```

Query projects table, then derive `envPath` from `environmentKey` (e.g. `envs/${environmentKey}`). All callers of `resolveInfraRepo` / `resolveInfraRepoByProjectAndEnvKey` must use this new resolver and receive the full config shape.


---

## Step 2.3 Add org_id to environments

Migration:

```
migrations/20260320002000_environments_org.sql
```

```sql
ALTER TABLE environments
ADD COLUMN org_id TEXT NOT NULL;
```

Update:

```
createEnvironment()
listEnvironments()
getEnvironmentById()
```


---

## Step 2.4 Add org_id to request docs

Modify request creation:

```
POST /api/requests
```

Set:

```
request.org_id = session.orgId
```

Ensure saved in S3 document.


---

## Step 2.5 Add org_id to requests_index

Migration:

```
ALTER TABLE requests_index
ADD COLUMN org_id TEXT NOT NULL;
```

Update indexer:

```
projectRequestToIndexValues()
INDEX_UPSERT_SQL
```


---

# Phase 3 — Read Path Scoping

## Step 3.1 Scope requests list

Modify:

```
lib/db/requestsList.ts
```

Add filter:

```
WHERE org_id = $1
```

Endpoint:

```
GET /api/requests
```

Pass:

```
session.orgId
```


---

## Step 3.2 Scope environments list

Modify:

```
listEnvironments()
```

Add:

```
WHERE org_id = $1
```


---

## Step 3.3 Scope request detail

Endpoint:

```
GET /api/requests/:id
```

Verify:

```
request.org_id == session.orgId
```

Otherwise:

```
404
```


---

## Step 3.4 Scope environment detail

Endpoint:

```
GET /api/environments/:id
```

Verify:

```
environment.org_id == session.orgId
```


---

## Step 3.5 Scope environment activity

Endpoint:

```
GET /api/environments/:id/activity
```

Steps:

1 verify environment ownership
2 query activity

Never query activity first.


---

# Phase 4 — Template Isolation

Use prefix storage strategy.

Request templates:

```
request-templates/<org_id>/
```

Environment templates:

```
environment-templates/<org_id>/
```

Modify:

```
lib/templates-store.ts
lib/env-templates-store.ts
```

Index location:

```
<org_id>/index.json
```


---

# Phase 5 — Insights Isolation

Modify:

```
GET /api/metrics/insights
```

Query:

```
SELECT * FROM requests_index
WHERE org_id = $1
```

Never scan S3.

Fail rule:

```
if (!session.orgId) return 403
```


---

# Phase 6 — Write Path Guards

Add ownership verification to **all routes that read or mutate a request or environment**. Rule: `resource.org_id == session.orgId` before any read or write.

**Request lifecycle (apply/destroy already listed):**

```
POST /api/requests/:id/apply
POST /api/requests/:id/destroy
```

**Additional request routes to guard:**

```
POST /api/requests/:id/approve
POST /api/github/merge
POST /api/github/update-branch
PATCH /api/requests/update
GET /api/requests/:id/sync
GET /api/requests/:id (detail — already in Phase 3)
GET /api/requests/:id/logs
GET /api/requests/:id/plan
GET /api/requests/:id/clarifications/respond
... any other request-detail-adjacent or output endpoints
```

**Environment routes (deploy/destroy already listed):**

```
POST /api/environments/:id/deploy
POST /api/environments/:id/destroy
```

**Additional environment routes to guard:**

```
GET /api/environments/:id (detail — already in Phase 3)
GET /api/environments/:id/activity (already in Phase 3)
```

**GitHub dispatch routes** (operate on requests; must verify request ownership before dispatch):

```
POST /api/github/plan
POST /api/github/apply
POST /api/github/merge
POST /api/github/update-branch
POST /api/requests/:id/destroy
POST /api/requests/drift-eligible (if it returns request data)
```

Review every route that reads or mutates a request or environment; enforce org ownership.


---

# Phase 7 — UI Org Badge

Modify:

```
components/layout/AppShell.tsx
```

Add component:

```
<OrgBadge />
```

Display:

```
session.orgSlug
```

Example UI:

```
[user avatar] username [org] sign out
```


---

# Phase 8 — Safety Validation

Before rollout validate:

1. requests cannot cross org
2. environments cannot cross org
3. deploy/destroy cannot cross org
4. templates isolated
5. insights isolated

Security check:

```
grep -R "getRequest("
grep -R "getEnvironment("
```

Verify org check exists before returning resource.

---

### Automated invariant tests

Add explicit automated tests for org invariants. Create or extend test suite (e.g. `tests/invariants/orgScoping.test.ts` or `tests/api/orgScoping.test.ts`):

| Test | Assertion |
|------|-----------|
| **List scoping by org** | GET /api/requests and GET /api/environments return only rows where `org_id` matches session; no cross-org leakage |
| **Detail 404 on cross-org access** | GET /api/requests/:id and GET /api/environments/:id return 404 when resource belongs to different org (not 200 with data) |
| **Create writes org_id from session** | POST /api/requests and POST /api/environments set `org_id` from `session.orgId`; client cannot override via request body |
| **Insights 403 without org** | GET /api/metrics/insights returns 403 when session has no orgId; never returns global/unfiltered data |
| **Template prefix isolation** | Request and environment templates are read/written under `request-templates/<org_id>/` and `environment-templates/<org_id>/`; no cross-org template access |

Run these tests in CI. They must pass before org support is considered complete.


---

# Invariants (must remain true)

```
INV-ORG-1 request belongs to exactly one org
INV-ORG-2 environment belongs to exactly one org
INV-ORG-3 project belongs to exactly one org
INV-ORG-4 list endpoints filter by org
INV-ORG-5 resource endpoints verify org ownership
INV-ORG-6 create operations set org_id from session
INV-ORG-7 postgres remains projection only
INV-ORG-8 org context must fail closed
INV-ORG-9 insights fail closed without org
```


---

# Estimated Effort

With Cursor:

```
12–16 hours
```

Without AI:

```
2–3 days
```


---

# Completion Criteria

Org support is complete when:

- users authenticate with org context
- requests are org scoped
- environments are org scoped
- projects are org scoped
- templates are org isolated
- insights are org isolated
- all request/environment read and mutate routes verify org ownership
- deploy/destroy verify org ownership
- UI displays org badge
- automated org invariant tests pass (list scoping, detail 404, create org_id from session, insights 403, template prefix isolation)
