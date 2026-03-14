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
- **`app/api/auth/`** — Session, GitHub OAuth, logout, me, orgs (GET org memberships for switcher), switch-org (POST).
- **`app/api/platform/orgs/`** — Platform-admin org management: list, create, archive, restore, org detail. Non-admins receive 404.
- **`app/settings/platform/orgs/`** — Platform admin UI: list orgs (filter active/archived/all), create org, view org detail, archive, restore.
- **`app/api/stream/`** — SSE: server pushes requestId/updatedAt so UI can revalidate.
- **`app/api/modules/`** — Module catalog and schema (Terraform modules).
- **`app/api/request-templates/`** — Request templates (admin/seed, CRUD).
- **`app/api/workspace-templates/`** — Workspace template list and by-id (S3 index + documents). Admin list/read/seed; no legacy environment-templates.
- **`app/projects/`** — Project list (`/projects`), create (`/projects/new`), detail with Workspaces/Settings/Access tabs (`/projects/[projectId]`), settings (`/projects/[projectId]/settings`), access (`/projects/[projectId]/access`), workspaces (`/projects/[projectId]/workspaces/new`, `…/workspaces/[workspaceId]`).
- **`app/api/projects/`** — Project CRUD: GET/POST `/api/projects`, GET/PATCH `/api/projects/[projectId]` (accepts project_key or id).
- **`app/api/workspaces/`** — Workspace list (GET), create (POST; reads repo from projects table).
- **`app/api/admin/audit/workspaces-missing-project/`** — Orphaned workspace audit (platform-admin).
- **`app/api/workspaces/[id]/`** — Workspace deploy (POST `:id/deploy`), destroy (POST `:id/destroy`); workspace deploy status and activity are served via workspace list/detail flows.
- **`app/api/health/`**, **`app/api/infra/`** — Health and infra checks.
- **`app/login/`**, **`app/aws/connect/`** — Login; AWS account connection (connect UI under aws).
- **`app/catalogue/`**, **`app/insights/`**, **`app/workspaces/new/`** — Module catalogue, Insights dashboard, new workspace (project-scoped).

### `lib/` — Domain and shared logic (no UI)

- **`lib/requests/`** — Request domain: `deriveLifecycleStatus`, `patchRequestFacts`, `persistWorkflowDispatch`, run index, sync policy, naming, id, lock (acquire/release, `isLockExpired`/`isLockActive`; expired = inactive; sync clears expired), idempotency, tags.
- **`lib/github/`** — GitHub domain: client, webhook (verify, idempotency), correlation, workflow classification, dispatch/cleanup, stream state, rate limiting, updateBranch.
- **`lib/storage/`** — S3 request store (read/write requests, history, optimistic locking).
- **`lib/status/`** — Canonical status config (labels, colors); consumed by UI and by `deriveLifecycleStatus`.
- **`lib/sse/`** — SSE stream client (UI subscription to request updates).
- **`lib/auth/`** — Session, roles, admin, requireActiveOrg (archived-org guard), projectAccess.
- **`lib/assistant/`** — Assistant state (e.g. for request creation flow).
- **`lib/plan/`** — Plan output stripping / formatting.
- **`lib/config/`** — Env, polling config.
- **`lib/validation/`** — e.g. resource naming.
- **`lib/observability/`** — Ops metrics (request aggregates, cached), GitHub API usage (in-memory: windows, top/hot routes, rate-limit events, kindGuess). Hooks for Insights dashboard. Logging, correlation.

**Deploy route dependency injection:** `app/api/workspaces/[id]/deploy/route.ts` uses `makePOST(deps)` for testability. Production export: `export const POST = makePOST(realDeps)`. Enables dependency-injection testing (see `tests/unit/projectAccessEnforcement.test.ts`).
- **`lib/logs/`** — Lifecycle logs.
- **`lib/infra/`** — e.g. module type.
- **`lib/db/projects.ts`** — Project CRUD: `createProject`, `updateProject`, `getProjectByKey`, `getProjectById`, `resolveProjectByIdOrKey`, `listOrphanedWorkspaceProjectKeys`.
- **`lib/workspaces/`** — Deploy detection (`isWorkspaceDeployed`, `getWorkspaceDeployStatus`), workspace skeleton (`workspaceSkeleton`), template validation (`validateTemplateId`), deploy PR, activity builder (`buildWorkspaceActivity`).
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

---

### Workspace as state boundary (Workspace Sharding)

TfPilot intentionally enforces a one-workspace-per-state-root model (**Workspace Sharding**). Scale by adding more workspaces, not by increasing the size of a workspace.

A workspace corresponds directly to a Terraform root located at:

`envs/<workspace_key>/<workspace_slug>/`

Each workspace owns: Terraform root, state boundary, deploy boundary, drift boundary, destroy boundary, and ownership boundary.

Workspaces should remain small and focused on a single infrastructure domain or service. Benefits: smaller Terraform states, faster plans, isolated drift, safer destroy, parallel deployments, clear ownership boundaries.

**Scaling rule:** more workspaces — not bigger workspaces.

---

### Platform primitives

The architecture exposes six major primitives (planned):

- **Workspace Runs Projection** — observability and analytics (Postgres projection of runs per workspace; never authoritative).
- **Variable Sets** — deterministic configuration inheritance (org/project/workspace scopes; secrets masked).
- **Policy Evaluation** — governance stage in the lifecycle (plan → policy evaluation → approval → apply).
- **Cost Governance** — evaluate plan-derived cost output; guardrails and approval requirements (not a lifecycle source of truth).
- **Enhanced Workspace Templates** — richer composable template stacks (TfPilot already has Workspace Templates; future = composition).
- **Platform metadata layer** — workspace metadata as a first-class control-plane primitive (not just tags). Single table `workspace_metadata` (workspace_id, owner_team, service, lifecycle_stage, business_criticality, system_tier, cloud_account_id); optional workspace_dependencies. Unlocks impact graph, blast radius, change intelligence, ownership routing, cost attribution, change sets, risk scoring, dashboards. Natural next layer because workspace is already the Terraform root and state boundary.
- **Deployment decision record** — unified approval object above policy, cost, and impact (not just PR/plan/policy passed). One object before apply: what is changing, who approved, policy/cost/impact/risk, safe to apply. Conceptual: `deployment_decision` (request_id, workspace_id, policy_result, cost_result, impact_result, approved_by, approval_reason, risk_level, created_at). Sits above the rest; decision-centric, not just run- or PR-centric.

These primitives extend the request-centric architecture without altering the core lifecycle model.

#### Opinionated Infrastructure Templates

Workspace Templates may evolve into **composable infrastructure stacks**. Templates would be able to assemble infrastructure components while controlling which parts users can modify. Goal: balance **standardization and developer flexibility**. This extends the request-centric architecture without altering lifecycle invariants.

#### Change management layer

TfPilot may evolve beyond request/run execution into a first-class change-management model. **Change Sets** are a future abstraction that can connect: request intent; plan/apply attempts; policy and cost evaluation; impact intelligence; rollback reference. This extends the request-centric architecture without replacing the existing facts-only lifecycle model.

#### Projection discipline

As TfPilot grows, additional read models and analytics layers may be introduced (e.g. workspace_runs, change_sets, cost/impact views), but they must never replace the authoritative request facts. The architecture remains: **facts → projection → UI**, not projection → inferred truth → lifecycle authority.

---

## Platform governance and workspace abstractions

The request-centric architecture is extended by the planned platform primitives above (Workspace Runs Projection, Variable Sets, Policy Evaluation, Cost Governance, Enhanced Workspace Templates, Platform metadata layer, Deployment decision record). These extend the platform without changing: facts-only lifecycle; GitHub execution boundary; S3 authority; workspace boundary model (Workspace Sharding).

TfPilot uses **Workspace Templates** as the environment abstraction; it does not need a separate "Environment Template" concept.
