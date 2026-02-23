# TfPilot Platform Review — For Agent Consumption

This document is an in-depth review of the TfPilot platform intended to be fed to another agent for follow-up review, refactors, or audits. It summarizes architecture, auth, API surface, storage, frontend, config, security, and gaps.

---

## 1. Overview & Mandatory Context

- **What TfPilot is:** Terraform self-service platform. Users create requests (project + environment + module + config); the app persists to S3, generates bounded Terraform blocks, opens PRs, and GitHub Actions run plan/apply/destroy/cleanup. "AI collects inputs; templates generate Terraform."
- **Mandatory docs (read first):**
  - `docs/SYSTEM_OVERVIEW.md` — high-level flow, repos, storage, auth, workflows, invariants
  - `docs/EXECUTION_PLAN.md` — roadmap, phases, principles, definition of done
  - `docs/prompts/MASTER.md` — role, mission, architectural rules, change protocol, safety constraints
- **Role routing:** `.cursor/rules/agent-routing.mdc` defines specialist prompts (frontend, backend, GitHub worker, Terraform generator/modules, platform-architect). Multi-area tasks → platform-architect first, then phased plan.
- **Non-negotiable invariants:** Terraform runs only in GitHub Actions; requests in S3; TfPilot edits only between `tfpilot:begin/<requestId>` and `tfpilot:end/<requestId>` markers; no breaking changes without migration + rollback plan.

---

## 2. Repo & Tech Stack

- **Platform repo:** TfPilot (this repo). Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui. TypeScript strict.
- **Infra repos:** e.g. `core-terraform`, `payments-terraform` — contain `envs/dev|prod`, `modules/`, `.github/workflows` (plan/apply/destroy/cleanup).
- **Infra for TfPilot itself:** `tfpilot-terraform` — ECS Fargate, ALB, ECR, etc. Deploy via GitHub Actions on push to `main`.
- **Key deps:** `@aws-sdk/client-s3`, `@aws-sdk/client-ses`, `@aws-sdk/client-sts`, `next`, `react`, `swr`, `zod`, `diff3`, `framer-motion`, `lucide-react`, `react-markdown`.

---

## 3. Architecture Summary

- **Execution boundary:** GitHub Actions only for Terraform. No local Terraform runs.
- **Storage:** S3. Requests: `requests/<requestId>.json` (optimistic locking via `version`). Destroyed: `history/<requestId>.json`. Lifecycle logs: `logs/<requestId>/<ts>.json`. Chat logs: separate bucket (SSE-S3). Cost: `cost/<requestId>/infracost-cost.json` (and diff).
- **Request lifecycle:** Create → Plan → Approve → Merge → Apply. Optional: Destroy (cleanup PR strips TfPilot block, then destroy); request archived to `history/`.
- **Status derivation:** `lib/requests/status.ts` — `deriveStatus()` from `pr`, `planRun`, `applyRun`, `approval`. UI uses `lib/status/status-config.ts` for labels/colors and `getDisplayStatusLabel()` for display.
- **Module catalogue:** `config/module-registry.ts` — single source of truth (s3-bucket, ec2-instance, ecr-repo, etc.). Fields, compute, defaults. UI and backend both use it.
- **Infra repo mapping:** `config/infra-repos.ts` — hardcoded registry keyed by `project/environment` (e.g. `core/dev`, `payments/prod`) with owner, repo, base, envPath. No session check in this file; used by API when resolving target repo.

---

## 4. Auth & Session

- **Session:** `lib/auth/session.ts`
  - Cookie: `tfplan_session`. Payload: `login`, `name`, `avatarUrl`, `email?`, `accessToken?`.
  - HMAC-SHA256 signed (base64url payload + signature). `AUTH_SECRET` required at runtime.
  - `getSessionFromCookies()`, `setSession()`, `clearSession()`. OAuth state cookie: `tfplan_oauth_state` (short-lived, domain set in prod from `GITHUB_OAUTH_REDIRECT`).
- **OAuth:** GitHub OAuth. Start: `app/api/auth/github/start/route.ts` (state, redirect_uri from `GITHUB_OAUTH_REDIRECT` or hardcoded tfpilot.com). Callback: `app/api/auth/github/callback/route.ts` — code exchange, fetch user + email, `TFPILOT_ALLOWED_LOGINS` allowlist, then set session and redirect to `/requests`.
- **Roles:** `lib/auth/roles.ts` — `getUserRole(login)` → viewer | developer | approver | admin from `TFPILOT_ADMINS` and `TFPILOT_APPROVERS`.
- **Admin by email:** `lib/auth/admin.ts` — `requireAdminByEmail()` uses session email and `TFPILOT_ADMIN_EMAILS`; returns 404 for non-admins (template admin routes).
- **GitHub token for API:** `lib/github/auth.ts` — `getGitHubAccessToken(req)` reads session from cookies (optionally from request) and returns `session.accessToken`. Used by sync, merge, update-branch, approve, destroy, plan, apply, etc.
- **No Next.js middleware:** There is no `middleware.ts` in the repo. Protection is per-route: each API route that needs auth calls `getSessionFromCookies()` (or `getGitHubAccessToken(req)`) and returns 401 when missing.

---

## 5. API Surface & Auth Coverage

**Fully session-protected (session required, 401 otherwise):**  
`/api/requests` (POST/GET list), `/api/requests/update`, `/api/requests/[requestId]/apply`, `/api/requests/[requestId]/destroy`, `/api/requests/[requestId]/approve`, `/api/requests/[requestId]/can-destroy`, `/api/requests/[requestId]/audit-export`, `/api/requests/[requestId]/assistant/state`, `/api/requests/[requestId]/clarifications/respond`, `/api/requests/[requestId]/logs`, `/api/github/plan`, `/api/github/apply`, `/api/github/merge`, `/api/github/update-branch`, `/api/github/plan-output`, `/api/templates/*`, `/api/templates/admin/*`, `/api/modules/schema`, `/api/policy`, `/api/metrics`, `/api/connect/aws` (if used with session).

**Protected by GitHub token (cookie-based session):**  
`/api/requests/[requestId]/sync` — use `getGitHubAccessToken(req)`; no token → 401. (Refresh endpoint removed; sync is the canonical way to refresh request state.)

**Webhook / secret (no session):**  
`/api/requests/drift-eligible`, `/api/requests/[requestId]/drift-result` — validate `x-tfpilot-secret` against `TFPILOT_WEBHOOK_SECRET`; drift-eligible also has in-memory rate limit by IP.

**Intentionally public or dev-only:**  
- `/api/health` — no auth; returns `{ status: "ok" }`.  
- `/api/debug/env` — returns 404 in production; in dev returns a subset of env (no secrets) for debugging.

**Gaps (no session or secret):**  
- **GET `/api/requests/[requestId]`** — No `getSessionFromCookies()` or token check. Anyone who knows `requestId` can read full request JSON (including config, PR info, cost, etc.). **Security finding.**  
- **POST `/api/infra-assistant`** — No session check. Accepts `messages`, `project`, `environment`, `module`, `fieldsMeta`, `currentInputs` and calls OpenAI. **Risk:** unauthenticated usage and OpenAI cost abuse.  
- **POST `/api/chat-logs`** — No session check. Writes chat log entries to S3. **Risk:** unauthenticated write to chat-logs bucket.  
- **GET `/api/modules/route`** and **GET `/api/modules/[name]/route`** — Read from `../terraform-modules` on disk. No session. May be intentional for public catalog; if not, consider auth.  
- **GET `/api/modules/catalog/route`** — Same as above; confirm whether catalog is meant to be public.

---

## 6. Storage & Request Shape

- **requestsStore:** `lib/storage/requestsStore.ts`
  - `getRequest(requestId)`, `saveRequest(request, { expectedVersion })`, `updateRequest(requestId, mutate)`, `listRequests(limit)`, `archiveRequest(request)`.
  - Optimistic locking: `expectedVersion` on save; `updateRequest` reads, mutates, increments version, saves with expected version.
  - S3: `ContentType: application/json`, `ServerSideEncryption: "AES256"`.
- **Request document shape (partial):** `id`, `project`, `environment`, `module`, `config`, `receivedAt`, `updatedAt`, `status`, `version`, `revision`, `plan`, `planRun`, `applyRun`, `approval`, `pr`, `activePrNumber`, `previousPrs`, `targetOwner`, `targetRepo`, `targetBase`, `targetEnvPath`, `targetFiles`, `branchName`, `prNumber`, `prUrl`, `commitSha`, `mergedSha`, `cost`, assistant state fields, etc. Cost can be merged from cost-service when present.
- **Lifecycle:** `lib/logs/lifecycle.ts` — `logLifecycleEvent({ requestId, event, actor?, source?, data? })` writes to `logs/<requestId>/<timestamp>.json` in same bucket. Failures are only logged to console so they don’t break the flow.
- **Cost:** `lib/services/cost-service.ts` — reads from S3 `cost/<requestId>/` (infracost JSON). Fetched in GET request and sync when available; not stored in request body.

---

## 7. Frontend & UI Patterns

- **Layout:** `app/layout.tsx` — Geist fonts, ThemeProvider, AuthProvider, AwsConnectionProvider, NavBar, main content. Theme script in head (localStorage + prefers-color-scheme).
- **Auth in UI:** `app/providers.tsx` — `AuthProvider` fetches `/api/auth/me` (credentials: include), exposes `user`, `loading`, `refresh`, `logout`. `AwsConnectionProvider` stores AWS connection state in localStorage.
- **Key pages:**  
  - `app/requests/page.tsx` — list with filters (status, env, module, project, search) and dataset modes (active/drifted/destroyed/all).  
  - `app/requests/[requestId]/page.tsx` — detail: overview (metadata, cost), timeline, actions (approve/merge/apply/destroy), plan diff, suggestion panel, assistant drawer.  
  - `app/requests/new/page.tsx` — new request: project/env/module selection, form from module registry, templates, assistant drawer and suggestion panel.  
  - `app/login/LoginClient.tsx` — login page with GitHub link and error display from query params.  
  - `app/catalogue/page.tsx`, `app/catalogue/[id]/page.tsx` — template catalogue (see §8).  
  - `app/aws/connect/page.tsx` — AWS connection.  
  - `app/environments/page.tsx` — environments.
- **Data fetching:** SWR. `hooks/use-request-status.ts` — `useRequestStatus(requestId, initial)` calls `/api/requests/<id>/sync`, merge strategy (whitelist keys: status, planRun, applyRun, pr, plan, cost, etc.), `refreshInterval` 3s when not terminal (complete/failed/destroyed), 0 when terminal.
- **Design:** Background-based separation (`bg-muted`/`bg-card`), no borders; light/dark theme. Components under `components/ui/` (shadcn). Status from `lib/status/status-config.ts` (`getStatusLabel`, `normalizeRequestStatus`).

---

## 8. Template catalogue — admin create/update from platform

The platform includes a **template catalogue** that allows admins to create, update, and manage request templates from the UI. All catalogue admin actions are gated by **admin-by-email** (`TFPILOT_ADMIN_EMAILS`); non-admins see a read-only browse experience.

### Storage

- **Bucket:** `TFPILOT_TEMPLATES_BUCKET` (S3). Prefix: `templates/`.
- **Index:** `templates/index.json` — array of `TemplateIndexEntry` (id, label, project, environment, module, enabled, updatedAt, version).
- **Per-template:** `templates/<id>.json` — full `StoredTemplate` (label, description, project, environment, module, defaultConfig, uiSchema, enabled, createdAt, updatedAt, version, createdBy, updatedBy, lockEnvironment, allowCustomProjectEnv).
- **Backend:** `lib/templates-store.ts` — getTemplatesIndex, getTemplate, createTemplate, createTemplateWithId, updateTemplate, disableTemplate, enableTemplate, deleteTemplate; index and objects updated atomically; ServerSideEncryption: AES256.

### Public (authenticated) behaviour

- **GET `/api/templates`** — Requires session. Returns only **enabled** templates (full objects). Used by the “new request” flow so users can start from a template.
- **Catalogue list (non-admin):** User hits `/catalogue`; if not admin, UI calls `/api/templates` and shows enabled templates with search (label, module, project, environment). “View” opens `/catalogue/[id]` (read-only view).

### Admin-only features (create/update from the platform)

Admins (session email in `TFPILOT_ADMIN_EMAILS`) get the full catalogue UI and admin API.

- **List (admin):** GET `/api/templates/admin` — returns full index (including disabled templates). Catalogue page shows version badge, enabled/disabled badge, and admin actions.
- **Create:** “New template” → `/catalogue/new`. Form: label, description, project (or “any”), environment, module, defaultConfig (per-module fields), uiSchema, enabled, lockEnvironment, allowCustomProjectEnv. POST `/api/templates/admin` creates template (id generated from label + shortId), writes S3 object and appends to index; `createdBy` from session email.
- **Read one:** GET `/api/templates/admin/[id]` — returns full template (admin only). Used for edit page and duplicate.
- **Update:** `/catalogue/[id]` (id ≠ "new") — edit form; PUT `/api/templates/admin/[id]` with UpdateTemplatePayload; `updatedBy` set from session; version incremented.
- **Duplicate:** From list, “Duplicate” loads template via GET admin/[id], sends POST `/api/templates/admin` with same payload and label “(copy)”;
- **Enable / disable (soft):** DELETE `/api/templates/admin/[id]` → disables template (disableTemplate); PATCH with `{ enabled: true }` → enables (enableTemplate). Disabled templates are excluded from `/api/templates` so they don’t appear in the new-request template list.
- **Delete (hard):** “Delete” in UI with confirmation; POST `/api/templates/admin/[id]/delete` — permanently removes template object and updates index (deleteTemplate).
- **Seed default templates:** “Import default templates” button → POST `/api/templates/admin/seed`. Idempotent: creates templates from `lib/templates-store-seed-defaults.ts` (DEFAULT_SEED_TEMPLATES); skips any id that already exists. Admin-only.

### API summary (catalogue)

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/templates` | GET | Session | List enabled templates (for new-request flow). |
| `/api/templates/[id]` | GET | Session | Get one template by id (e.g. for viewing in catalogue). |
| `/api/templates/admin` | GET | Admin (email) | Full index (all templates). |
| `/api/templates/admin` | POST | Admin | Create template. |
| `/api/templates/admin/[id]` | GET | Admin | Get full template. |
| `/api/templates/admin/[id]` | PUT | Admin | Update template. |
| `/api/templates/admin/[id]` | DELETE | Admin | Disable template (soft). |
| `/api/templates/admin/[id]` | PATCH | Admin | Enable template (or partial update). |
| `/api/templates/admin/[id]/delete` | POST | Admin | Permanently delete template. |
| `/api/templates/admin/seed` | POST | Admin | Seed default templates (idempotent). |

### UI pages

- **`app/catalogue/page.tsx`** — List: search, cards (label, module, project, env, version, enabled). Admin: New template, Import default templates, per-card Edit / Duplicate / Enable|Disable / Delete; delete confirmation dialog. Non-admin: View only.
- **`app/catalogue/[id]/page.tsx`** — View or edit: project/env/module, defaultConfig fields (from module schema), description, uiSchema, enabled, lockEnvironment, allowCustomProjectEnv. For id `new`, create; otherwise update. Validation uses module registry (required fields, enum, types).

---

## 9. Config & Environment

- **Env type:** `lib/config/env.ts` — typed `Env` with required/list helpers. Build-time: if not Vercel/AWS/ECS, missing vars get placeholders so Next build succeeds; at runtime in ECS, real values from SSM. Lists: `TFPILOT_ALLOWED_LOGINS`, `TFPILOT_PROD_ALLOWED_USERS`, `TFPILOT_DESTROY_PROD_ALLOWED_USERS`, `TFPILOT_ADMINS`, `TFPILOT_APPROVERS`, `TFPILOT_ALLOWED_REGIONS`, `TFPILOT_ADMIN_EMAILS` (comma-separated).
- **Workflows:** Single source of truth: `lib/config/env.ts` (`GITHUB_PLAN_WORKFLOW_FILE`, etc.). `config/workflows.ts` re-exports from env for backwards compatibility.
- **env.example:** Documents OAuth, AUTH_SECRET, GitHub defaults, OpenAI, buckets, allow-lists, RBAC, policy regions, email. No `TFPILOT_WEBHOOK_SECRET` in env.example (used by drift endpoints).
- **Infra repos:** Hardcoded in `config/infra-repos.ts`; not env-driven. Changing projects/environments requires code change.

---

## 10. AI Assistant & Infra Assistant

- **Assistant state:** `lib/assistant/state.ts` — Zod schemas for patches, suggestions, clarifications. Paths must match `/^(inputs|advanced)\//`. Stored in request document; `ensureAssistantState()` ensures shape. Updates via `/api/requests/[requestId]/assistant/state` and clarifications via `/api/requests/[requestId]/clarifications/respond` (both session-protected).
- **Infra assistant API:** `app/api/infra-assistant/route.ts` — POST, expects `messages`, optional `project`, `environment`, `module`, `fieldsMeta`, `currentInputs`. Calls OpenAI with system prompt that demands JSON-only response (patch, rationale, clarifications, confidence). No session check — see API gaps above.
- **Sanitization:** `lib/agent/sanitize.ts` and `utils/assistantNormalize.ts` — used to sanitize/normalize assistant output.

---

## 11. GitHub Integration & Workflows

- **Client:** `lib/github/client.ts` — `gh(token, path, options)` for GitHub API.  
- **Branch/PR:** `lib/github/updateBranch.ts` — update branch, create PR, supersede previous PRs.  
- **Plan/apply/destroy dispatch:** API routes dispatch workflows by name (from env), with ref and inputs (e.g. `request_id`, `environment`). Prod actions gated by `TFPILOT_PROD_ALLOWED_USERS` and destroy by `TFPILOT_DESTROY_PROD_ALLOWED_USERS`.  
- **Plan output:** Workflow uploads plan artifact; `plan-output` route (session via token) records runId/url/status/conclusion and plan diff.  
- **Concurrency:** Documented as shared per project+env+request in workflow design (in infra repos).

---

## 12. Observability & Notifications

- **Lifecycle:** S3 lifecycle logs per request; timeline and audit export from these.  
- **Email:** `lib/notifications/email.ts` — AWS SES; admin notifications (e.g. apply/destroy/plan success or failure). Uses `TFPILOT_ADMIN_EMAILS`, `TFPILOT_EMAIL_FROM`.  
- **Endpoints:** `/api/health` (ok), `/api/metrics` (session required; returns total requests, status counts, success rate, failure/destroyed counts, avg apply time).  
- **Drift:** Drift-eligible and drift-result endpoints; webhook secret; drift status surfaced in UI.

---

## 13. Testing & Quality

- **Unit / integration tests:** No `*.test.ts` or `*.test.tsx` and no `__tests__` directory found in the TfPilot repo. Testing is a clear gap.
- **Scripts:** `validate:registry` (module registry), `validate:tags` (server tags). Lint: `npm run lint` (ESLint).
- **Types:** TypeScript strict; some `any` in storage and request types (e.g. `requestsStore`, request payloads in API).

---

## 14. Deployment & Build

- **Next:** `next.config.ts` — `output: 'standalone'` for Docker; turbopack root set; remote images for GitHub avatars.
- **Deploy:** GitHub Actions build Docker image, push to ECR, update ECS task definition and service (see README and tfpilot-terraform).
- **Runtime env:** Injected in ECS (e.g. from SSM). Build uses placeholders when env not available.

---

## 15. Gaps & Risks Summary (for follow-up agent)

1. **Auth gaps**  
   - **GET `/api/requests/[requestId]`** — Unauthenticated; any party with request ID can read full request. Recommend: require session (or at least same-origin + session for browser).  
   - **POST `/api/infra-assistant`** — Unauthenticated; OpenAI abuse and cost. Recommend: require session.  
   - **POST `/api/chat-logs`** — Unauthenticated write to S3. Recommend: require session.  
   - **GET `/api/modules`**, **GET `/api/modules/[name]`**, **GET `/api/modules/catalog`** — Unauthenticated; confirm if public-by-design.

2. **No global auth layer**  
   - No middleware; each route opts in. Easy to add new routes without auth. Consider a small `requireSession()` helper and use it consistently, or middleware for `/api/*` (excluding health/webhooks).

3. **No automated tests**  
   - No tests in repo. Prioritize: critical API routes (create request, status derivation, auth), session encode/decode, policy validation.

4. **Infra repo list**  
   - Hardcoded in code. If multiple teams/projects, consider config or env-driven mapping.

5. **env.example**  
   - Add `TFPILOT_WEBHOOK_SECRET` for drift webhooks.

6. **Types**  
   - Reduce `any` in request/storage layers; add shared request type(s) used by API and storage.

7. **OAuth callback**  
   - Callback uses `GITHUB_OAUTH_REDIRECT` for redirect origin; start route enforces exact prod callback URL. Good. Ensure Host header is never used for redirect in prod (already avoided).

---

## 16. File Reference (key files for review)

- Auth: `lib/auth/session.ts`, `lib/auth/roles.ts`, `lib/auth/admin.ts`, `lib/github/auth.ts`, `app/api/auth/github/start/route.ts`, `app/api/auth/github/callback/route.ts`.  
- API (sample): `app/api/requests/route.ts`, `app/api/requests/[requestId]/route.ts`, `app/api/requests/[requestId]/sync/route.ts`, `app/api/infra-assistant/route.ts`, `app/api/chat-logs/route.ts`.  
- **Template catalogue (admin):** `lib/templates-store.ts`, `lib/templates-store-seed-defaults.ts`, `app/api/templates/route.ts`, `app/api/templates/admin/route.ts`, `app/api/templates/admin/[id]/route.ts`, `app/api/templates/admin/[id]/delete/route.ts`, `app/api/templates/admin/seed/route.ts`, `app/catalogue/page.tsx`, `app/catalogue/[id]/page.tsx`.  
- Storage: `lib/storage/requestsStore.ts`, `lib/logs/lifecycle.ts`, `lib/services/cost-service.ts`.  
- Status: `lib/requests/status.ts`, `lib/status/status-config.ts`.  
- Config: `lib/config/env.ts` (workflow names + env; canonical), `config/workflows.ts` (re-exports workflow names), `config/infra-repos.ts`, `config/module-registry.ts`.  
- Frontend: `app/layout.tsx`, `app/providers.tsx`, `hooks/use-request-status.ts`, `app/requests/[requestId]/page.tsx`, `app/requests/new/page.tsx`.  
- Docs: `docs/SYSTEM_OVERVIEW.md`, `docs/EXECUTION_PLAN.md`, `docs/prompts/MASTER.md`, `.cursor/rules/agent-routing.mdc`.

---

*End of platform review. Use this document together with the mandatory docs and role routing when having another agent perform security review, refactors, or feature work.*
