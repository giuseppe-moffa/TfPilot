# ORG_SUPPORT_FORENSIC_REPORT

## 1. Executive summary

**Feasibility:** Org support is feasible with moderate effort. The codebase has clear boundaries (auth, storage, APIs) and no hard-coded single-tenant assumptions in core logic. The main work is additive: new tables, session extension, and scoping filters at well-defined points.

**Key risks:**
- **Data leakage:** GET /api/requests, GET /api/environments, insights, and catalogue currently return all data; missing `org_id` filters would expose cross-org data.
- **Migration complexity:** S3 request docs, Postgres index, environments table, and S3 templates lack `org_id`; backfill and index rebuild are required.
- **Project/repo mapping:** `config/infra-repos.ts` is global; org-scoped project ownership needs a design decision (per-org config vs shared registry).

**Recommended MVP shape:**
- Phase 1: Org tables + seed `default` org; org membership + session org resolution.
- Phase 2: Scope list endpoints (requests, environments, catalogue, insights) by org; add `org_id` to write paths.
- Phase 3: UI org badge; defer org switcher and org settings.

---

## 2. Current architecture findings

### 2.1 Auth/session

| Aspect | Evidence |
|--------|----------|
| **OAuth flow** | `app/api/auth/github/start/route.ts` initiates; `app/api/auth/github/callback/route.ts` exchanges code, fetches user/email, enforces allowlist, sets session. |
| **Session shape** | `lib/auth/session.ts`: `SessionPayload = { login, name, avatarUrl, email?, accessToken? }`. No org fields. |
| **Session storage** | Signed JWT-like cookie `tfplan_session` (base64 payload + HMAC-SHA256). `encodePayload`/`decodeSessionToken`; `setSession`/`clearSession`/`getSessionFromCookies`. |
| **Login allowlist** | `app/api/auth/github/callback/route.ts` line 170: `env.TFPILOT_ALLOWED_LOGINS.length > 0 && !env.TFPILOT_ALLOWED_LOGINS.includes(user.login)` → redirect to `/login?error=not_allowed`. |
| **Role resolution** | `lib/auth/roles.ts`: `getUserRole(login)` → `viewer` \| `developer` \| `approver` \| `admin` from `TFPILOT_ADMINS`, `TFPILOT_APPROVERS`. |
| **Admin-by-email** | `lib/auth/admin.ts`: `requireAdminByEmail()` checks `session.email` against `TFPILOT_ADMIN_EMAILS`; returns 404 for non-admins. |
| **Session read sites** | `getSessionFromCookies()` / `requireSession()` used in: `app/api/requests/route.ts`, `app/api/environments/route.ts`, `app/api/environment-templates/*`, `app/api/request-templates/*`, `app/api/auth/me/route.ts`, deploy/destroy routes, etc. |
| **Auth me endpoint** | `app/api/auth/me/route.ts`: returns `{ authenticated, user, role }`; `role` from `getUserRole(session.login)`. |
| **Session extension** | Adding `orgId`, `orgSlug`, `orgRole` is straightforward: extend `SessionPayload`, set after resolving org membership, include in `encodePayload`/`decodeSessionToken`. No breaking change if new fields are optional initially. |
| **Single-context assumption** | No explicit "user belongs to one org" assumption in code; roles are global (login-based). Org would introduce per-org context. |

### 2.2 RBAC

| Aspect | Evidence |
|--------|----------|
| **Role types** | `lib/auth/roles.ts`: `viewer`, `developer`, `approver`, `admin`. |
| **Permission enforcement** | `docs/RBAC.md`; enforcement in route handlers: `getUserRole(session.login)` then branch on role. |
| **Request lifecycle** | POST create: `viewer` blocked (`app/api/requests/route.ts` ~525); approve/merge/apply: `approver` or `admin`; destroy: `admin` only; prod allowlists: `TFPILOT_PROD_ALLOWED_USERS`, `TFPILOT_DESTROY_PROD_ALLOWED_USERS`. |
| **Environment auth** | Create: `viewer` blocked; deploy/destroy: `admin` only (`app/api/environments/[id]/deploy/route.ts`, destroy route). |
| **Catalogue/Insights** | `requireAdminByEmail()` on template admin routes and Insights page (`app/insights/page.tsx`). |
| **Org-scoped roles** | Roles are currently global. Org-scoping would require: (a) org membership table with role, (b) `getUserOrgRole(login, orgId)` or session carrying `orgRole`, (c) enforcement points unchanged but using org role. |
| **Global allowlists** | `TFPILOT_ADMINS`, `TFPILOT_APPROVERS`, `TFPILOT_ADMIN_EMAILS`, `TFPILOT_PROD_ALLOWED_USERS`, `TFPILOT_DESTROY_PROD_ALLOWED_USERS` are env vars. For MVP: retain as bootstrap-only or map to default org; per-org allowlists would be a later phase. |

### 2.3 Storage and sources of truth

| Store | Path / schema | Authority | org_id today |
|-------|---------------|-----------|--------------|
| **S3 request docs** | `requests/<requestId>.json` | Authoritative | No |
| **Postgres requests_index** | `lib/db/indexer.ts`, `migrations/20260301000000_requests_index.sql`, `20260304100000_requests_index_environment_slug.sql` | Projection only | No |
| **Postgres environments** | `migrations/20260303100000_environments.sql`; `lib/db/environments.ts` | Authoritative for env metadata | No |
| **S3 request-templates** | `request-templates/index.json`, `request-templates/<id>.json`; `lib/templates-store.ts` | Authoritative | No |
| **S3 environment-templates** | `environment-templates/index.json`, `environment-templates/<id>.json`; `lib/env-templates-store.ts` | Authoritative | No |
| **Run index (S3)** | `webhooks/github/run-index/<kind>/` | Correlation only | N/A |

**Indexer projection** (`lib/db/indexer.ts`): `projectRequestToIndexValues` maps request doc → index row. Columns: `request_id`, `created_at`, `updated_at`, `repo_full_name`, `environment_key`, `environment_slug`, `module_key`, `actor`, `pr_number`, `merged_sha`, `last_activity_at`, `doc_hash`. No `org_id`.

**Write-through:** `lib/storage/requestsStore.ts` `saveRequest()` → `putRequest()` then `upsertRequestIndex()`. Index failures logged, not thrown.

**Request doc shape:** Contains `project_key`, `environment_key`, `environment_slug`, `environment_id`, `module`, `config`, etc. No `org_id`. Adding `org_id` is additive; `deriveLifecycleStatus` does not depend on it.

### 2.4 Read paths

| Area | Route / page | Data source | Filtering today | org_id injection point |
|------|--------------|-------------|-----------------|-------------------------|
| **Requests list** | GET `/api/requests` | Postgres `listRequestIndexRowsPage` → S3 `getRequest` per row | None (global list) | Add `WHERE org_id = $1` to `SELECT_PAGE_SQL` / `SELECT_PAGE_WITH_CURSOR_SQL` in `lib/db/requestsList.ts` |
| **Environments list** | GET `/api/environments` | Postgres `listEnvironments` | `project_key`, `include_archived` | Add `org_id` to `listEnvironments` options and `WHERE` |
| **Catalogue (env templates)** | GET `/api/environment-templates`, `/api/environment-templates/[id]` | S3 `getEnvTemplatesIndex`, `getEnvTemplate` | `enabled` only | Need org-scoped index or prefix (e.g. `environment-templates/<org_id>/`) |
| **Catalogue (request templates)** | GET `/api/request-templates`, `/api/request-templates/admin` | S3 `getTemplatesIndex`, `getTemplate` | `enabled`; admin returns all | Same: org-scoped index or prefix |
| **Insights** | GET `/api/metrics/insights` | S3 `listRequests(1000)` | None | Must filter by org before `buildOpsMetrics`; or use Postgres index with org filter |
| **Environment activity** | GET `/api/environments/:id/activity` | Postgres `listRequestIndexRowsByEnvironment` | `repo_full_name`, `environment_key`, `environment_slug` | Environment must be org-scoped; activity inherits |
| **Request detail** | GET `/api/requests/[requestId]` (implied) | S3 `getRequest` | By id | Must verify request belongs to session org before returning |

**Fail-closed:** If `org_id` is missing from session, list endpoints should return 403 or empty, not unfiltered data. Activity and request detail must validate org membership of the resource.

**Data leakage risks:** Without org filter: (1) requests list shows all orgs; (2) environments list shows all orgs; (3) insights aggregates all requests; (4) templates are global. Partial scoping (e.g. only requests) would leak via environments or vice versa.

### 2.5 Write paths

| Write path | Route | Auth | Persistence | org_id attachment point |
|------------|-------|------|-------------|---------------------------|
| **Create request** | POST `/api/requests` | `requireSession`, `getUserRole`, prod allowlists | `saveRequest` → S3 + `upsertRequestIndex` | Set `newRequest.org_id = session.orgId` before save; indexer must project `org_id` |
| **Create environment** | POST `/api/environments` | Session, `viewer` blocked | `createEnvironment` → Postgres | Add `org_id` to `createEnvironment` params; migration adds column |
| **Request templates admin** | POST `/api/request-templates/admin`, PUT/DELETE `admin/[id]` | `requireAdminByEmail` | `createTemplate`, `updateTemplate`, etc. in `lib/templates-store.ts` | Store `org_id` in template doc; or use org-prefixed S3 path |
| **Environment templates admin** | POST `/api/environment-templates/admin`, etc. | `requireAdminByEmail` | `lib/env-templates-store.ts` | Same pattern |
| **Deploy environment** | POST `/api/environments/:id/deploy` | `admin` only | GitHub PR + env record | Verify env belongs to session org before deploy |
| **Destroy request** | POST `/api/requests/:id/destroy` | `admin` only | `archiveRequest`, index delete | Verify request belongs to session org |
| **Destroy environment** | POST `/api/environments/:id/destroy` | `admin` only | `archiveEnvironment` | Verify env belongs to session org |

**Invariants:** S3 remains authoritative for requests; lifecycle derived from facts only; Terraform only in GitHub Actions. Adding `org_id` does not violate these.

### 2.6 UI shell touchpoints

| Location | Evidence |
|----------|----------|
| **User avatar/login/signout** | `components/layout/AppShell.tsx` lines 168–191: `user.avatarUrl`, `user.login`, Sign out button; `useAuth()` from `app/providers`. |
| **Auth provider** | `app/providers`: `fetchSession()` → `GET /api/auth/me`; `AuthUser = { login, name, avatarUrl }`; no org in client state. |
| **Org badge placement** | Best place: between `user.login` and Sign out in AppShell header (line ~179). Small badge component showing `orgSlug` or org name. |
| **Org switcher** | AppShell has no dropdown for context; would need a new component (e.g. org selector next to user). Route structure (`/requests`, `/environments`, etc.) assumes single scope; org switcher would switch session org and re-fetch. |
| **Route scope** | All routes are global; no `/org/:orgSlug/` prefix. Org would be implicit from session. |

### 2.7 Project/repo ownership model

| Aspect | Evidence |
|--------|----------|
| **project_key → infra repo** | `config/infra-repos.ts`: hardcoded `registry` map `"core/dev"`, `"core/prod"`, `"payments/dev"`, `"payments/prod"` → `{ owner, repo, base, envPath }`. |
| **Resolution** | `resolveInfraRepo(project, environment)`; `resolveInfraRepoByProjectAndEnvKey(project_key, environment_key)`. |
| **List projects** | `listProjects()` returns `["core", "payments"]` from registry keys. |
| **Config type** | Static config file; not DB-backed. |
| **Ownership** | Global; no per-org or per-user ownership. |
| **MVP recommendation** | (a) **project_key unique per org:** Each org has its own project namespace; `core` in org A ≠ `core` in org B. Safest: org-scoped project registry or `org_id` on project mapping. (b) **project_key global:** Simpler but multiple orgs share projects; requires org→project membership or explicit sharing model. (c) **Safest MVP:** `project_key` unique per org; add `org_id` to infra-repos resolution (or org-scoped config). |

---

## 3. Required touchpoints for org support

### 3.1 Database

| Change | Details |
|--------|---------|
| **orgs table** | `id`, `slug`, `name`, `created_at`, `updated_at`. Seed `default` org. |
| **org_memberships table** | `org_id`, `login`, `role`, `invited_at`, etc. Seed default org with all current `TFPILOT_ADMINS`/`TFPILOT_APPROVERS` as members. |
| **requests_index** | Add `org_id TEXT`; migration; index for list query. |
| **environments** | Add `org_id TEXT NOT NULL`; migration; backfill existing rows to `default` org. |
| **Indexer** | `projectRequestToIndexValues` and `INDEX_UPSERT_SQL` must include `org_id`. |
| **listEnvironments** | Add `org_id` to options; `WHERE org_id = $n`. |
| **listRequestIndexRowsPage** | Add `org_id` param; `WHERE org_id = $n` (and retain cursor semantics). |
| **listRequestIndexRowsByEnvironment** | Environment already scoped; ensure env belongs to org (caller checks). |

### 3.2 S3 documents

| Change | Details |
|--------|---------|
| **Request docs** | Add `org_id` to new requests; backfill script for existing (set to `default`). |
| **Request templates** | Option A: add `org_id` to index entry and doc; filter by org in `getTemplatesIndex`. Option B: S3 prefix `request-templates/<org_id>/`. |
| **Environment templates** | Same options. |
| **doc_hash** | `computeDocHash` includes all fields; adding `org_id` changes hash. Rebuild index after backfill. |

### 3.3 Session/auth

| Change | Details |
|--------|---------|
| **SessionPayload** | Add `orgId?: string`, `orgSlug?: string`, `orgRole?: string`. |
| **OAuth callback** | After login, resolve org membership (e.g. default org for MVP); set org fields in session. |
| **Invite flow** | New: admin invites GitHub login → insert `org_memberships`. Not in MVP if using seed-only. |
| **getUserRole** | For org-scoped actions, use `orgRole` from session or `getUserOrgRole(login, orgId)`. |
| **requireSession** | No change; session already required. |
| **Auth me** | Extend response with `org: { id, slug, name }`, `orgRole`. |

### 3.4 API read paths

| Endpoint | Change |
|----------|--------|
| GET `/api/requests` | Require `session.orgId`; pass to `listRequestIndexRowsPage({ org_id, limit, cursor })`; 403 if no org. |
| GET `/api/environments` | Require `session.orgId`; `listEnvironments({ org_id, project_key?, include_archived })`. |
| GET `/api/environment-templates` | Filter by org (index or prefix). |
| GET `/api/request-templates` | Filter by org. |
| GET `/api/metrics/insights` | Filter requests by org before `buildOpsMetrics`; or add org-scoped list. |
| GET `/api/environments/:id` | Verify `env.org_id === session.orgId`; 404 otherwise. |
| GET `/api/environments/:id/activity` | Same verification. |
| GET `/api/requests/:id` (detail) | Verify `request.org_id === session.orgId`; 404 otherwise. |

### 3.5 API write paths

| Endpoint | Change |
|----------|--------|
| POST `/api/requests` | Set `newRequest.org_id = session.orgId`; validate env belongs to org. |
| POST `/api/environments` | Pass `org_id: session.orgId` to `createEnvironment`. |
| Request/env template admin | Pass `org_id` to create/update; or use org-scoped storage. |
| Deploy/destroy | Verify resource `org_id === session.orgId` before proceeding. |

### 3.6 UI

| Change | Details |
|--------|---------|
| **Org badge** | Add near user in AppShell; display `orgSlug` or org name. |
| **Auth provider / auth me** | Include org in `user` or separate `org`; UI reads for badge. |
| **Org switcher** | Deferred; would need org list from membership, switch endpoint to set session org. |

---

## 4. Risk analysis

### 4.1 Data leakage risks

- **Partial scoping:** If only requests are scoped but environments are not (or vice versa), users could infer or access other orgs’ data through linked resources.
- **Mitigation:** Scope all list and detail endpoints together; enforce org check on every resource access.
- **Insights:** `listRequests` from S3 has no org filter; must either (a) add org filter to a new S3 list path, or (b) use Postgres index with org filter and aggregate from there.
- **Templates:** Global S3 index; without org filter, all orgs see all templates. Must scope before MVP.

### 4.2 Migration risks

- **Backfill order:** Seed `default` org first; backfill `environments.org_id`, `requests_index.org_id`, request S3 docs; then rebuild index. Wrong order could create orphans.
- **Index rebuild:** `npm run db:rebuild-index` must read `org_id` from S3 docs; indexer must project it. Rows without `org_id` after backfill should be excluded or defaulted.
- **Session compatibility:** Old sessions without `orgId` must be handled: redirect to org selection or assign default org. Session extension is additive; old cookies may not have org fields until re-login.

### 4.3 Backward compatibility risks

- **Existing requests/environments:** Must backfill `org_id = default`. No schema change to request lifecycle; `deriveLifecycleStatus` unchanged.
- **Templates:** Legacy templates have no `org_id`; treat as `default` org or require migration.
- **API clients:** Adding required `org_id` to responses or requiring org context could break clients; prefer additive fields and server-side resolution from session.

### 4.4 Operational risks

- **Default org bootstrap:** All existing users must be added to `default` org with appropriate roles. Manual or script.
- **Invite flow:** If deferred, org membership is seed-only; no self-service invites.
- **Rollback:** DB migrations reversible with down migrations; S3 backfill is additive (new field). Session changes are backward compatible if org fields optional during transition.

---

## 5. Invariants impact

| Invariant | Impact |
|-----------|--------|
| **S3 authoritative** | Unchanged. `org_id` is another fact; lifecycle derivation unchanged. |
| **Lifecycle from facts only** | Unchanged. |
| **Terraform only in GitHub Actions** | Unchanged. |
| **No hidden status in Postgres** | Unchanged. `org_id` is metadata, not status. |
| **Environment deploy detection facts-based** | Unchanged. |
| **New org invariants** | (a) User can only access resources where `resource.org_id = session.orgId`. (b) All list endpoints must filter by `org_id`. (c) Write paths must set `org_id` from session. |

---

## 6. Recommended phased rollout

| Phase | Scope | Deliverables |
|-------|-------|--------------|
| **1** | Org tables + seed; membership + session | Migrations for `orgs`, `org_memberships`; seed `default` org; resolve org on login; extend session with `orgId`, `orgSlug`, `orgRole`; add `org_id` to `environments` and `requests_index`; backfill existing data. |
| **2a** | Scope list endpoints | `listRequestIndexRowsPage`, `listEnvironments` accept `org_id`; GET `/api/requests`, GET `/api/environments` pass session org; 403 if no org. |
| **2b** | Scope catalogue + insights | Templates: org-scoped index or filter; insights: filter by org. |
| **2c** | Add org_id to write paths | Create request, create environment, template admin: set `org_id`; verify org on deploy/destroy. |
| **3** | UI org badge | AppShell shows org near user; auth me returns org. |
| **Later** | Org switcher, org settings | Org list from membership; switch endpoint; settings page for admins. |

**Prerequisite hardening:** Ensure `requireSession` is used consistently; no unauthenticated list endpoints. Verify all resource access validates ownership (env, request) before returning data.

---

## 7. Open questions / decisions needed

1. **Project/repo mapping:** Per-org project registry vs global registry with org→project membership?
2. **Template storage:** Org-prefixed S3 path (`request-templates/<org_id>/`) vs `org_id` in doc and filtered index?
3. **Invite flow:** In MVP or deferred? If deferred, how are users added to orgs (manual DB, script)?
4. **Default org assignment:** On first login, assign to `default` org automatically, or require org selection?
5. **Multi-org users:** Can a user belong to multiple orgs? Session holds one `orgId`; switcher would change it. Membership table supports multiple rows per login.
6. **Bootstrap allowlists:** `TFPILOT_ADMINS` etc. map to default org members with admin role, or remain global bootstrap?

---

## 8. File-by-file evidence map

| File | Relevance |
|------|-----------|
| `lib/auth/session.ts` | Session shape, encode/decode, getSessionFromCookies, requireSession |
| `lib/auth/roles.ts` | getUserRole, role types |
| `lib/auth/admin.ts` | requireAdminByEmail |
| `app/api/auth/github/callback/route.ts` | OAuth callback, login allowlist, setSession |
| `app/api/auth/me/route.ts` | Auth me response shape |
| `lib/config/env.ts` | TFPILOT_* allowlists, env config |
| `app/api/requests/route.ts` | GET list (Postgres + S3), POST create (session, role, saveRequest) |
| `lib/db/requestsList.ts` | listRequestIndexRowsPage, listRequestIndexRowsByEnvironment, SQL |
| `lib/db/indexer.ts` | projectRequestToIndexValues, upsertRequestIndex, INDEX_UPSERT_SQL |
| `lib/storage/requestsStore.ts` | saveRequest, getRequest, listRequests |
| `lib/db/environments.ts` | createEnvironment, listEnvironments, getEnvironmentById |
| `app/api/environments/route.ts` | GET/POST environments |
| `app/api/environment-templates/route.ts` | GET env templates |
| `app/api/request-templates/route.ts` | GET request templates |
| `lib/env-templates-store.ts` | S3 env templates, getEnvTemplatesIndex |
| `lib/templates-store.ts` | S3 request templates, getTemplatesIndex |
| `app/api/metrics/insights/route.ts` | Insights metrics, listRequests |
| `config/infra-repos.ts` | Project→repo mapping, resolveInfraRepo |
| `components/layout/AppShell.tsx` | User avatar, login, signout; org badge placement |
| `app/providers` | useAuth, fetchSession |
| `lib/requests/resolveRequestEnvironment.ts` | Environment resolution for create |
| `migrations/20260303100000_environments.sql` | Environments schema |
| `migrations/20260301000000_requests_index.sql` | requests_index schema |
| `migrations/20260304100000_requests_index_environment_slug.sql` | environment_slug column |
| `docs/RBAC.md` | RBAC model |
| `docs/INVARIANTS.md` | Platform invariants |

---

## Appendix A: Suggested schema candidates

*(Suggestions only; not final decisions.)*

### orgs

```sql
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### org_memberships

```sql
CREATE TABLE org_memberships (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  login TEXT NOT NULL,
  role TEXT NOT NULL,  -- viewer, developer, approver, admin
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, login)
);
```

### Session shape candidate

```ts
type SessionPayload = {
  login: string
  name: string | null
  avatarUrl: string | null
  email?: string | null
  accessToken?: string | null
  // Org extension
  orgId?: string
  orgSlug?: string
  orgRole?: "viewer" | "developer" | "approver" | "admin"
}
```

---

## Appendix B: Suggested session resolution flow

1. User completes GitHub OAuth.
2. Lookup `org_memberships` where `login = user.login`.
3. If one row: set `orgId`, `orgSlug`, `orgRole` from that org.
4. If multiple: use first (or "last used" if stored); org switcher would update.
5. If none: assign to `default` org with `developer` role (or 403 "no org").
6. Encode extended payload into session cookie.
