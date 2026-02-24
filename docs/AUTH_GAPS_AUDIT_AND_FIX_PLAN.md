# Auth Gaps Audit + Fix Plan (Read-Only)

**Document type:** Audit and prioritized fix plan. No code changes in this deliverable.

**Scope:** All API routes and relevant page routes; auth mechanisms; sensitive endpoints; intentional public; bypass paths.

---

## A) Route map (full table)

### API routes

| Route | Method | File | Purpose | Auth mechanism | Expected | Gap? |
|-------|--------|------|---------|----------------|----------|------|
| `/api/requests` | POST | `app/api/requests/route.ts` | Create request, branch, PR, plan dispatch | getSessionFromCookies + getUserRole (≠ viewer) + getGitHubAccessToken | Session + token | N |
| `/api/requests` | GET | `app/api/requests/route.ts` | List all requests (full docs + derived status) | **None** | Session | **Y** |
| `/api/requests/[requestId]` | GET | `app/api/requests/[requestId]/route.ts` | Get one request + cost | requireSession | Session | N |
| `/api/requests/[requestId]/sync` | GET | `app/api/requests/[requestId]/sync/route.ts` | Hydrate from GitHub, derive status, persist | getGitHubAccessToken only | Session/token | N (token = session in practice) |
| `/api/requests/update` | POST | `app/api/requests/update/route.ts` | Update request (patch/config) | getSessionFromCookies + getUserRole + getGitHubAccessToken | Session + token | N |
| `/api/requests/[requestId]/approve` | POST | `app/api/requests/[requestId]/approve/route.ts` | Record approval, GitHub review | getSessionFromCookies + getUserRole (approver/admin) + getGitHubAccessToken | Session + role + token | N |
| `/api/requests/[requestId]/apply` | POST | `app/api/requests/[requestId]/apply/route.ts` | Dispatch apply workflow | getSessionFromCookies + getUserRole (approver/admin) + getGitHubAccessToken + prod allowlist | Session + role + token | N |
| `/api/requests/[requestId]/destroy` | POST | `app/api/requests/[requestId]/destroy/route.ts` | Dispatch cleanup + destroy, set destroyRun, archive | getSessionFromCookies + getUserRole (admin) + getGitHubAccessToken + prod/destroy allowlists | Session + admin + token | N |
| `/api/requests/[requestId]/can-destroy` | GET | `app/api/requests/[requestId]/can-destroy/route.ts` | Can user destroy this request? | getSessionFromCookies + getUserRole (admin) | Session + admin | N |
| `/api/requests/[requestId]/audit-export` | GET | `app/api/requests/[requestId]/audit-export/route.ts` | Export request + lifecycle events (S3) | getSessionFromCookies | Session | N |
| `/api/requests/[requestId]/assistant/state` | POST | `app/api/requests/[requestId]/assistant/state/route.ts` | Write assistant state (suggestions, clarifications) | getSessionFromCookies | Session | N |
| `/api/requests/[requestId]/clarifications/respond` | POST | `app/api/requests/[requestId]/clarifications/respond/route.ts` | Submit clarifications, update request | getSessionFromCookies | Session | N |
| `/api/requests/[requestId]/logs` | GET | `app/api/requests/[requestId]/logs/route.ts` | List lifecycle log events for requestId | getSessionFromCookies | Session | N |
| `/api/requests/drift-eligible` | GET | `app/api/requests/drift-eligible/route.ts` | List requests eligible for drift (webhook) | x-tfpilot-secret (validateWebhookSecret) + rate limit | Secret | N |
| `/api/requests/[requestId]/drift-result` | POST | `app/api/requests/[requestId]/drift-result/route.ts` | Store drift result for requestId | x-tfpilot-secret (validateWebhookSecret) | Secret | N |
| `/api/github/plan` | POST | `app/api/github/plan/route.ts` | Dispatch plan workflow | getSessionFromCookies + getGitHubAccessToken + prod allowlist | Session + token | N |
| `/api/github/apply` | POST | `app/api/github/apply/route.ts` | Dispatch apply workflow | getSessionFromCookies + getUserRole + getGitHubAccessToken + prod allowlist | Session + role + token | N |
| `/api/github/merge` | POST | `app/api/github/merge/route.ts` | Merge PR (optional update-branch retry) | getSessionFromCookies + getUserRole + getGitHubAccessToken | Session + role + token | N |
| `/api/github/update-branch` | POST | `app/api/github/update-branch/route.ts` | Update branch (merge base, resolve conflicts) | getSessionFromCookies + getGitHubAccessToken (inferred from usage) | Session + token | N |
| `/api/github/plan-output` | GET | `app/api/github/plan-output/route.ts` | Plan output for requestId (GitHub logs) | getSessionFromCookies + getGitHubAccessToken | Session + token | N |
| `/api/github/pr-diff` | GET | `app/api/github/pr-diff/route.ts` | PR files/diff for requestId | getSessionFromCookies + getGitHubAccessToken | Session + token | N |
| `/api/github/approval-status` | GET | `app/api/github/approval-status/route.ts` | PR reviews for requestId | getSessionFromCookies + getGitHubAccessToken | Session + token | N |
| `/api/github/apply-output` | GET | `app/api/github/apply-output/route.ts` | Apply run logs for requestId | getSessionFromCookies + getGitHubAccessToken | Session + token | N |
| `/api/metrics` | GET | `app/api/metrics/route.ts` | Legacy metrics (list 200, aggregate) | getSessionFromCookies | Session | N |
| `/api/metrics/insights` | GET | `app/api/metrics/insights/route.ts` | Insights metrics (list 1000, buildOpsMetrics) | getSessionFromCookies | Session | N |
| `/api/templates` | GET | `app/api/templates/route.ts` | List enabled templates | getSessionFromCookies | Session | N |
| `/api/templates/[id]` | GET | `app/api/templates/[id]/route.ts` | Get template by id | getSessionFromCookies | Session | N |
| `/api/templates/admin` | GET/POST | `app/api/templates/admin/route.ts` | List all templates / create | requireAdminByEmail + getSessionFromCookies (for POST body) | Admin (404) | N |
| `/api/templates/admin/[id]` | GET/PUT | `app/api/templates/admin/[id]/route.ts` | Get/update template | requireAdminByEmail + getSessionFromCookies | Admin (404) | N |
| `/api/templates/admin/[id]/delete` | DELETE | `app/api/templates/admin/[id]/delete/route.ts` | Delete template | requireAdminByEmail | Admin (404) | N |
| `/api/templates/admin/seed` | POST | `app/api/templates/admin/seed/route.ts` | Seed default templates | requireAdminByEmail | Admin (404) | N |
| `/api/modules/schema` | GET | `app/api/modules/schema/route.ts` | Module registry schema (filtered) | getSessionFromCookies | Session | N |
| `/api/modules` | GET | `app/api/modules/route.ts` | List modules from disk (../terraform-modules) | **None** | Session or public | **Y** |
| `/api/modules/[name]` | GET | `app/api/modules/[name]/route.ts` | Get module metadata by name (disk) | **None** | Session or public | **Y** |
| `/api/modules/catalog` | GET | `app/api/modules/catalog/route.ts` | Catalog from disk (../terraform-modules) | **None** | Session or public | **Y** |
| `/api/policy` | GET | `app/api/policy/route.ts` | Naming policy, allowed regions | getSessionFromCookies | Session | N |
| `/api/connect/aws` | POST | `app/api/connect/aws/route.ts` | Validate AWS credentials, return identity | getSessionFromCookies | Session | N |
| `/api/infra-assistant` | POST | `app/api/infra-assistant/route.ts` | OpenAI assistant (patch, clarifications) | requireSession | Session | N |
| `/api/chat-logs` | POST | `app/api/chat-logs/route.ts` | Append chat log entry to S3 | requireSession | Session | N |
| `/api/auth/me` | GET | `app/api/auth/me/route.ts` | Current session or unauthenticated | getSessionFromCookies (returns 200 with authenticated: false if none) | Intentional public | N |
| `/api/auth/logout` | POST | `app/api/auth/logout/route.ts` | Clear session | — | Public (logout) | N |
| `/api/auth/github/start` | GET | `app/api/auth/github/start/route.ts` | OAuth start (redirect) | — | Public (entry to login) | N |
| `/api/auth/github/callback` | GET | `app/api/auth/github/callback/route.ts` | OAuth callback, set session | — | Public (callback) | N |
| `/api/health` | GET | `app/api/health/route.ts` | Liveness | **None** | Intentional public | N |
| `/api/debug/env` | GET | `app/api/debug/env/route.ts` | Subset of env (no secrets); 404 in production | **None** | Intentional public (dev) | N |
| `/api/infra/health` | GET | `app/api/infra/health/route.ts` | Resolve infra repo for project/env, return repo/base/envPath | **None** | Session or public | **Y** |

### Page routes (gating expectation)

| Route | File | Purpose | Gate | Gap? |
|-------|------|---------|------|------|
| `/` | `app/page.tsx` | Redirect to /requests or /login | Client: useAuth(); redirect if !user | N (client-side) |
| `/login` | `app/login/page.tsx` | Login UI | Public | N |
| `/requests` | `app/requests/page.tsx` | List requests (fetches GET /api/requests) | No server gate; client fetches API (cookie sent). If API were protected, 401 would show. | N (API gap is separate) |
| `/requests/[requestId]` | `app/requests/[requestId]/page.tsx` | Request detail (fetches sync) | Client: useRequestStatus (cookie sent) | N |
| `/requests/[requestId]/plan` | `app/requests/[requestId]/plan/page.tsx` | Plan view | Client | N |
| `/requests/new` | `app/requests/new/page.tsx` | New request form | Client | N |
| `/catalogue` | `app/catalogue/page.tsx` | Template catalogue | Client | N |
| `/catalogue/[id]` | `app/catalogue/[id]/page.tsx` | Template detail | Client | N |
| `/environments` | `app/environments/page.tsx` | Environments | Client | N |
| `/aws/connect` | `app/aws/connect/page.tsx` | AWS connection | Client | N |
| `/insights` | `app/insights/page.tsx` | Insights dashboard (fetches /api/metrics/insights) | Client (API is session-protected) | N |

Pages do not perform server-side session checks; they rely on client-side auth state and API returning 401 when unauthenticated. So fixing API gaps is the priority.

---

## B) Current auth patterns (short summary)

- **Session:** Cookie `tfplan_session` (HMAC-signed). `getSessionFromCookies()` returns session or null. `requireSession(store?, context?)` returns session or `NextResponse.json(UNAUTHORIZED_JSON, 401)`.
- **GitHub token:** Stored in session. `getGitHubAccessToken(req)` reads session (from cookies/request) and returns `session.accessToken` or null. Routes that need GitHub API call this and return 401 if !token.
- **Role:** `getUserRole(login)` → viewer | developer | approver | admin from env `TFPILOT_ADMINS`, `TFPILOT_APPROVERS`. Used for create (viewer → 403), apply/approve/merge (approver or admin), destroy (admin only).
- **Admin (templates):** `requireAdminByEmail()` uses session email and `TFPILOT_ADMIN_EMAILS`; if not allowed returns `NextResponse.json({ error: "Not found" }, 404)` (hide existence).
- **Prod allowlists:** `TFPILOT_PROD_ALLOWED_USERS` for plan/apply/merge/destroy in prod; `TFPILOT_DESTROY_PROD_ALLOWED_USERS` for destroy in prod.
- **Webhook:** Drift endpoints validate header `x-tfpilot-secret` against `TFPILOT_WEBHOOK_SECRET` (constant-time compare); 401 if invalid. drift-eligible also has in-memory rate limit by IP.
- **No middleware:** There is no `middleware.ts`. Every route that should be protected must call one of the above guards explicitly.

---

## C) Auth gap findings

### Tier A — Must-fix (sensitive endpoints exposed)

| # | Route | Method | File | Risk |
|---|-------|--------|------|------|
| A1 | `/api/requests` | GET | `app/api/requests/route.ts` | **Lists all requests** (full request documents: id, project, environment, module, config, status, PR info, planRun, applyRun, etc.). Anyone can enumerate and read all request data without session. |

### Tier B — Should-fix (inconsistent coverage / future risk)

| # | Route | Method | File | Risk |
|---|-------|--------|------|------|
| B1 | `/api/modules` | GET | `app/api/modules/route.ts` | Reads from `../terraform-modules`; returns module metadata. No session. Inconsistent with `/api/modules/schema` (session required). If catalog is not intended public, this exposes structure. |
| B2 | `/api/modules/[name]` | GET | `app/api/modules/[name]/route.ts` | Same; single module metadata from disk. No session. |
| B3 | `/api/modules/catalog` | GET | `app/api/modules/catalog/route.ts` | Same; catalog from disk. No session. |
| B4 | `/api/infra/health` | GET | `app/api/infra/health/route.ts` | Returns which infra repo (owner/repo, base, envPath) is configured for project+env. No session. Info disclosure (repo layout). |

### Tier C — Nice-to-have (hardening)

| # | Item | Notes |
|---|------|------|
| C1 | **Sync: session before token** | Sync uses only `getGitHubAccessToken(req)`; no explicit `getSessionFromCookies()`. Token is stored in session, so in practice session is required. Adding a session check would make intent explicit and align with other routes. |
| C2 | **auth/me response when unauthenticated** | Returns `{ authenticated: false }` with 200. Could return 401 for consistency with other APIs; current behavior is often used by UIs to “check if logged in” without treating as error. |
| C3 | **Consistent 401 body** | Some routes return `{ error: "Not authenticated" }`, others `{ success: false, error: "..." }`. Standardizing on `UNAUTHORIZED_JSON` or a single shape improves client handling. |

---

## D) Fix plan (no code)

### Tier A

**A1 — GET /api/requests (list)**

- **File:** `app/api/requests/route.ts`
- **Current:** GET handler (lines ~773–793) has no auth; calls `timeAsync("request.list", ...)`, `listRequests()`, `deriveLifecycleStatus`, returns JSON.
- **Guard to apply:** Call `requireSession(undefined, correlation)` at the start of the GET handler. If it returns a `NextResponse`, return it (401). Otherwise continue with existing logic.
- **Expected behavior when unauthorized:** 401 JSON (e.g. `{ error: "Unauthorized" }` per `UNAUTHORIZED_JSON`).
- **Exemptions:** None.
- **Snippet (current pattern in same file for POST):**
  ```ts
  const sessionOr401 = await requireSession(undefined, correlation)
  if (sessionOr401 instanceof NextResponse) return sessionOr401
  const session = sessionOr401
  ```

### Tier B

**B1 — GET /api/modules**

- **File:** `app/api/modules/route.ts`
- **Current:** No session or token check; reads from disk, returns catalog.
- **Guard to apply:** `getSessionFromCookies()`; if !session return `NextResponse.json({ error: "Not authenticated" }, { status: 401 })`.
- **Expected behavior when unauthorized:** 401 JSON.
- **Exemptions:** If product decision is “public catalog”, document and leave as-is; otherwise add guard.

**B2 — GET /api/modules/[name]**

- **File:** `app/api/modules/[name]/route.ts`
- **Current:** No auth.
- **Guard to apply:** Same as B1: session check, 401 if missing.
- **Expected behavior when unauthorized:** 401 JSON.
- **Exemptions:** Same as B1.

**B3 — GET /api/modules/catalog**

- **File:** `app/api/modules/catalog/route.ts`
- **Current:** No auth.
- **Guard to apply:** Same as B1/B2.
- **Expected behavior when unauthorized:** 401 JSON.
- **Exemptions:** Same as B1.

**B4 — GET /api/infra/health**

- **File:** `app/api/infra/health/route.ts`
- **Current:** No auth; returns repo info for project+env.
- **Guard to apply:** `getSessionFromCookies()`; if !session return 401 JSON.
- **Expected behavior when unauthorized:** 401 JSON.
- **Exemptions:** If this is used by a public or CI health check that cannot send cookies, consider a separate internal/health path or allowlist; document.

### Tier C (summary only; no file edits in this plan)

- **C1:** In `app/api/requests/[requestId]/sync/route.ts`, add `requireSession(undefined, correlation)` (or at least `getSessionFromCookies()` and 401 if !session) before calling `getGitHubAccessToken(req)`.
- **C2:** Optional: change `/api/auth/me` to return 401 when !session for consistency; assess impact on existing clients that rely on 200 + `authenticated: false`.
- **C3:** Prefer returning `UNAUTHORIZED_JSON` from `lib/auth/session` for all 401s and use the same body across routes.

---

## E) Intentional public endpoints (confirmed)

| Route | Method | Why public | Auth enforced? |
|-------|--------|------------|----------------|
| `/api/health` | GET | Liveness/load balancer | N/A (no auth by design) |
| `/api/debug/env` | GET | Dev-only env dump; 404 in production | Yes (404 in prod) |
| `/api/auth/me` | GET | Let UI check “am I logged in?” without error | Returns 200 + authenticated: false when no session |
| `/api/auth/logout` | POST | Logout | N/A |
| `/api/auth/github/start` | GET | OAuth entry | N/A |
| `/api/auth/github/callback` | GET | OAuth callback | N/A |
| `/api/requests/drift-eligible` | GET | Webhook for drift runner | Yes: x-tfpilot-secret, 401 if invalid; rate limit |
| `/api/requests/[requestId]/drift-result` | POST | Webhook to post drift result | Yes: x-tfpilot-secret, 401 if invalid |

---

## F) Bypass paths checked

- **Routes that accept requestId and return data:** GET `/api/requests/[requestId]`, GET sync, GET logs, GET audit-export, GET plan-output, GET pr-diff, GET approval-status, GET apply-output, POST assistant/state, POST clarifications/respond. All of these either use `requireSession` or `getSessionFromCookies` + 401 (or token which implies session). **No bypass found** for single-request read paths (once GET list is fixed).
- **Server actions:** No server actions found that call these APIs without the client sending cookies; client fetch with same-origin sends cookies by default.
- **Pages that fetch data server-side:** Not found; list and detail use client-side SWR/fetch to `/api/requests` and `/api/requests/[id]/sync`. So fixing GET `/api/requests` and (if desired) modules/infra/health closes the meaningful bypasses identified.

---

## G) Suggested “single source of truth” approach (high level)

- **Recommendation:** Keep **route-level guards** as the single source of truth for now. Each handler that must be protected explicitly calls `requireSession` or session + role/token/secret as appropriate.
- **Rationale:** (1) No middleware today; adding middleware later is a larger change and could affect OAuth and webhook paths. (2) Explicit per-route checks make it easy to see which route is protected and how. (3) Fixing Tier A/B does not require a new abstraction.
- **Future option:** If the codebase grows and many routes share the same “session required” pattern, consider a small helper (e.g. `withSession(req, handler)`) that runs `requireSession` and invokes the handler with session; do **not** implement middleware in this task.

---

*End of audit. No code changes; fix plan is reference only.*
