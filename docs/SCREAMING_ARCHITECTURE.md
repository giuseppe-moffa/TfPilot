# TfPilot — Screaming Architecture

**Doc index:** [docs/DOCS_INDEX.md](DOCS_INDEX.md).  
**System context:** [docs/SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

## What “screaming architecture” means here

The codebase is organized so that **top-level folders and route shapes reflect the product**: Terraform **requests**, their **lifecycle**, **GitHub** integration, and **storage**. A new developer opening the repo should immediately see “this app is about requests, GitHub, and Terraform workflow,” not “this is a Next.js app with some APIs.”

(Concept: [Uncle Bob — Screaming Architecture](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html): the architecture should scream the use case, not the framework.)

---

## What the layout screams

| Area | What it screams |
|------|------------------|
| **Requests** | The app is request-centric. Create, view, approve, apply, destroy — all keyed by request. |
| **GitHub** | Execution and source of truth live in GitHub: PRs, workflows, webhooks. |
| **Storage** | Requests and run index live in S3; no hidden local state. |
| **Status** | Lifecycle status is derived from facts (single place: `deriveLifecycleStatus`). |
| **Stream / SSE** | Single global SSE subscriber in root layout; on request event, mutate request key immediately and list key after 300ms debounce. UI stays fresh without duplicate subscribers. |
| **Modules / templates** | Terraform is generated from modules and templates; AI collects inputs, templates render. |

---

## Top-level map

### `app/` — Routes and pages (user-facing and API)

- **`app/requests/`** — Request list, request detail `[requestId]`, new request, plan view. The primary user journey.
- **`app/api/requests/`** — Request CRUD, sync, approve, apply, destroy, assistant state, drift, logs. Request-scoped APIs.
- **`app/api/github/`** — Plan/apply dispatch, merge, webhook receiver, plan/apply output, PR diff. GitHub as execution boundary.
- **`app/api/auth/`** — Session, GitHub OAuth, logout, me.
- **`app/api/stream/`** — SSE: server pushes requestId/updatedAt so UI can revalidate.
- **`app/api/modules/`** — Module catalog and schema (Terraform modules).
- **`app/api/templates/`** — Block templates (admin/seed, CRUD).
- **`app/api/health/`**, **`app/api/infra/`** — Health and infra checks.
- **`app/login/`**, **`app/connect/`**, **`app/aws/`**, **`app/catalogue/`**, **`app/insights/`**, **`app/environments/`** — Login, AWS connect, catalogue, insights, environments.

### `lib/` — Domain and shared logic (no UI)

- **`lib/requests/`** — Request domain: `deriveLifecycleStatus`, `patchRequestFacts`, `persistWorkflowDispatch`, run index, sync policy, naming, id, lock (acquire/release, `isLockExpired`/`isLockActive`; expired = inactive; sync clears expired), idempotency, tags.
- **`lib/github/`** — GitHub domain: client, webhook (verify, idempotency), correlation, workflow classification, dispatch/cleanup, stream state, rate limiting, updateBranch.
- **`lib/storage/`** — S3 request store (read/write requests, history, optimistic locking).
- **`lib/status/`** — Canonical status config (labels, colors); consumed by UI and by `deriveLifecycleStatus`.
- **`lib/sse/`** — SSE stream client (UI subscription to request updates).
- **`lib/auth/`** — Session, roles, admin.
- **`lib/assistant/`** — Assistant state (e.g. for request creation flow).
- **`lib/plan/`** — Plan output stripping / formatting.
- **`lib/config/`** — Env, polling config.
- **`lib/validation/`** — e.g. resource naming.
- **`lib/observability/`** — Ops metrics (request aggregates, cached), GitHub API usage (in-memory: windows, top/hot routes, rate-limit events, kindGuess). Hooks for Insights dashboard. Logging, correlation.
- **`lib/logs/`** — Lifecycle logs.
- **`lib/infra/`** — e.g. module type.
- **`lib/notifications/`**, **`lib/services/`** — Notifications and shared services.

### `components/` — UI building blocks

- **`components/ui/`** — Generic UI primitives.
- **`components/status/`** — Status badges, labels, etc. (driven by `lib/status/status-config` and derived status).

---

## How this aligns with the platform model

- **Requests** are the first-class entity; **GitHub** is the execution boundary; **S3** is the store; **status** is always derived.
- **`app/api/requests`** and **`app/api/github`** mirror that split; **`lib/requests`** and **`lib/github`** hold the domain rules (lifecycle derivation, webhook correlation, run index, sync).
- **`lib/storage`** and **`lib/status`** are thin and focused; **`lib/sse`** is the bridge from webhook patches to UI freshness.

For execution boundary, request lifecycle, and webhook behavior, see **docs/REQUEST_LIFECYCLE.md**, **docs/GITHUB_WORKFLOWS.md**, and **docs/WEBHOOKS_AND_CORRELATION.md**.
