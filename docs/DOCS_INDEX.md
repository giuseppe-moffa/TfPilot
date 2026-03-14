# TfPilot documentation index

Canonical docs only. **Current API is workspace-first;** all infra lifecycle uses `/api/workspaces` and project-scoped workspace URLs; `/api/environments` has been removed.

## Doc refresh (first-class projects and workspaces) — 2026-03-08

**What changed**
- **Projects and workspaces:** Projects and workspaces are now first-class, user-managed resources. SYSTEM_OVERVIEW documents project/workspace lifecycle, project creation, workspace creation (reads repo from projects table), access management.
- **API.md:** Projects endpoints (GET/POST /api/projects, GET/PATCH /api/projects/[projectId]), workspaces (GET/POST /api/workspaces), admin audit (GET /api/admin/audit/workspaces-missing-project).
- **GLOSSARY.md:** Project, Workspace, Project access, Orphaned workspace terms.
- **SCREAMING_ARCHITECTURE.md:** app/projects/, app/api/projects/, app/api/workspaces/, lib/db/projects.ts.
- **plans-and-deltas/ARCHITECTURE_DELTA_PROJECTS_FIRST_CLASS.md:** Status set to Implemented; Current State and API routes updated.
- **plans-and-deltas/PROJECTS_FIRST-CLASS_IMPLEMENTATION_PLAN.md:** All phases (A–E) marked complete.

---

## Doc refresh (multi-org, platform admin, org lifecycle) — 2026-03-07

**What changed**
- **Multi-org architecture:** SYSTEM_OVERVIEW documents orgs, org_memberships, session org context, org switching, platform admin vs org admin vs project access. Sources of truth table includes org tables.
- **Org lifecycle:** Create, archive, restore; archived_at semantics; archived org runtime enforcement (requireActiveOrg); platform admin bypass.
- **Teams:** teams, team_memberships, project_team_access, projects tables; Team → project access model.
- **Platform admin system:** /api/platform/orgs, /settings/platform/orgs; list, create, archive, restore, org detail. Non-admins receive 404.
- **Runtime guard:** requireActiveOrg(session) documented; applied in org-scoped routes; platform routes bypass.
- **RBAC.md:** Platform admin, project access, dual permission model (RBAC + project access). Examples: Approve, Apply, Deploy, Destroy.
- **ORGANISATIONS.md:** Org lifecycle, archived enforcement, org switcher (excludes archived, switch rejected).
- **API.md:** Auth orgs, switch-org, platform orgs endpoints.
- **POSTGRES_INDEX.md:** Org and project tables (orgs, org_memberships, teams, team_memberships, project_team_access, projects).
- **OPERATIONS.md:** Platform admin org management runbook.
- **INSIGHTS.md:** Ops metrics org-scoped; requires session.orgId; 403 when org archived.
- **Org Lifecycle Test Coverage:** 273 tests covering org lifecycle, archived enforcement, platform admin gating, org creation, org switching, RBAC + project access. See tests/unit/orgLifecycle.test.ts, tests/api/orgLifecycleRoute.test.ts.

---

For archived/retired docs see `docs/archive/`. For design proposals and implementation plans see `docs/plans-and-deltas/`.

---

## Doc reorganization (plans and deltas) — 2026-03-07

**What changed**
- **Moved** all plan and delta docs into `docs/plans-and-deltas/`: ARCHITECTURE_DELTA_*, *_IMPLEMENTATION_PLAN.md, ENVIRONMENT_TEMPLATES_DELTA.md, ENVIRONMENTS_IMPLEMENTATION_PLAN.md.
- **Root docs/** now contains only main canonical docs; design proposals and implementation plans live in `docs/plans-and-deltas/`.
- **DOCS_INDEX:** Added plans-and-deltas section; updated table paths; added pointer for design/plan docs.
- **Cross-references:** Updated lib/environments/helpers.ts, tests/invariants/deployErrors.test.ts, and internal doc links.

---

## Doc refresh (remove CONTEXT_PACK, EXECUTION_PLAN) — 2026-03-04

**What changed**
- **Removed:** `CONTEXT_PACK.md`, `EXECUTION_PLAN.md` (retired). Use DOCS_INDEX for canonical doc list; lifecycle/webhook context from REQUEST_LIFECYCLE, GITHUB_WORKFLOWS, WEBHOOKS_AND_CORRELATION.
- **Agent routing:** `.cursor/rules/agent-routing.mdc` mandatory context now SYSTEM_OVERVIEW + MASTER only (was 3 docs).
- **MASTER prompt:** Required reading now SYSTEM_OVERVIEW only; canonical list remains DOCS_INDEX.
- **DOCS_INDEX:** Table rows for CONTEXT_PACK and EXECUTION_PLAN removed; changelog refs to these docs removed.

---

## Doc refresh (Model 2 + Environment Activity + full alignment) — 2026-03-04

**What changed**
- **Terraform root (Model 2):** All docs reflect `envs/<workspace_key>/<workspace_slug>/` layout; request files `<module>_req_<request_id>.tf`; paths derived from (module, request_id); no `req_<id>.tf`, no single-root model.
- **Workspace lifecycle (then env-named):** Create (POST /api/workspaces), Deploy (POST /api/workspaces/:id/deploy → branch `deploy/<key>/<slug>`), deploy detection (GET :id), activity (GET :id/activity). *(Historical: docs previously referred to environment APIs; these are now workspace APIs.)*
- **Deploy error semantics:** Workspace deploy uses `WORKSPACE_*` error codes (409 already deployed / in progress, 503 check failed, 400 invalid template). Branch-only and PR-open treated same.
- **Workspace Activity:** `GET /api/workspaces/:id/activity` — event types `workspace_deployed`, `workspace_deploy_pr_open`, `request_created`; Postgres-only (no S3); fail-closed on deploy check.
- **Postgres `requests_index`:** `workspace_key`, `workspace_slug` columns; activity filtering by (repo_full_name, workspace_key, workspace_slug). See POSTGRES_INDEX.md. Post-deploy: `npm run db:migrate`, `npm run db:rebuild-index`.
- **Deploy route:** `makePOST(deps)` dependency injection; `export const POST = makePOST(realDeps)` for production.
- **Platform invariants:** Terraform roots env-specific; request filenames derived from module+request_id; lifecycle from facts only; attempts on dispatch only.
- **Future roadmap:** Drift detection, plan/apply activity events, environment health indicators (marked as future).

---

## Doc refresh (Post Environment Templates implementation) — 2026-03-03

**What changed**
- **Architecture alignment (Phases 0–6):** All docs reflect Model 2: Terraform repo structure `envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf`; no `req_<id>.tf`. Request files use canonical `<module>_req_<request_id>.tf`.
- **Workspace lifecycle:** Create (POST /api/workspaces), Deploy (POST /api/workspaces/:id/deploy → branch `deploy/<key>/<slug>`), deploy detection (GET /api/workspaces/:id → `deployed`, `deployPrOpen`, `deployPrUrl`, `envRootExists`; fail-closed `WORKSPACE_DEPLOY_CHECK_FAILED`).
- **Workspace templates:** S3 `templates/workspaces/` index + documents; template-only model. workspaceSkeleton (env deploy via envSkeleton shim) generates bootstrap request files.
- **Module Registry:** Docs list s3-bucket, ec2-instance, ecr-repo, cloudwatch-log-group, iam-role; registry defines schema; Terraform modules may not yet exist in infra repos.
- **New Request gating:** `lib/new-request-gate.ts`; messages: "Environment must be deployed before creating resources", "Environment deployment in progress", "Cannot verify deploy status".
- **API.md:** Workspace endpoints (GET/POST /api/workspaces, GET /api/workspaces/:id, POST /api/workspaces/:id/deploy); workspace templates (GET /api/workspace-templates).
- **INVARIANTS.md:** Workspace deploy invariants INV-WS-1..4 (deploy detection, fail-closed, atomic rollback), INV-GATE-1..2 (New Request gating).
- **Canonical:** Request and workflow dispatch use `workspace_id`, `workspace_key`, `workspace_slug` only.
- **Obsolete removals:** No references to legacy `environment_*` identifiers, `req_<id>.tf`, single-root paths in canonical docs.

---

## Doc refresh (full documentation refresh) — 2026-03-02

**What changed**
- **SCREAMING_ARCHITECTURE.md:** Fixed app layout — `app/connect/` → `app/aws/connect/`; clarified AWS connect vs catalogue/insights/environments.
- **FORENSIC_STORAGE_INVARIANTS_REPORT.md:** Added `history/` read path — `fetchRequestFromHistory` in audit-export route when request not in active store.
- **ARCHITECTURE_DELTA_DB.md:** Added header linking to POSTGRES_INDEX.md as current canonical for schema and behavior.
- **DOCS_INDEX.md:** Added ARCHITECTURE_DELTA_DB and FORENSIC_STORAGE_INVARIANTS_REPORT to table as reference docs.
- S3 + Postgres projection for list; write-through indexing; GET /api/requests requires Postgres (503 when unset).
- **tfpilot-terraform README.md** (infra repo): Corrected workflow env var names (GITHUB_*_WORKFLOW_FILE); added Postgres EC2 to cost estimate; cost total ~$36–40.

---

## Doc refresh (Postgres index + API + operations) — 2026-03-02

**What changed**
- **SYSTEM_OVERVIEW.md:** Added **Sources of truth** (S3 authoritative, Postgres projection only); clarified PR-native control plane; Tier-A invariants table with enforcement references. Link to POSTGRES_INDEX.md.
- **OPERATIONS.md:** Added **Rebuild and prune Postgres index** (`npm run db:rebuild-index`, `--prune`), **Verify Postgres connectivity** (`GET /api/health/db`, migrations), **Common failure scenarios** (503 when DB not configured, NoSuchKey list_errors, index_drift, invalid cursor).
- **POSTGRES_INDEX.md** (new): `requests_index` schema, `doc_hash` determinism, write-through boundary, drift detection, list_errors and missing S3 doc behavior, rebuild/prune.
- **API.md** (new): GET /api/requests response shape (next_cursor, list_errors, drift fields), cursor pagination semantics, GET /api/health/db and DB-optional 503 behavior.
- **README.md:** Core invariants mention S3 authority + Postgres projection; Documentation links to POSTGRES_INDEX.md and API.md; new **Deployment and config** subsection (env vars, Secrets Manager keys, ECS valueFrom, Postgres EC2/DNS, migrations).
- **DOCS_INDEX.md:** This entry and table entries for POSTGRES_INDEX.md, API.md.

---

## Doc add (USEFUL_COMMANDS.md)

**What changed**
- **docs/USEFUL_COMMANDS.md** added: quick reference for app run, Postgres (Docker, migrate, rebuild-index), webhook tunnel (ngrok/cloudflared/localtunnel), invariant tests and validation scripts, health/API, one-off Postgres run.

---

## Doc add (INVARIANTS.md) — 2026-02-28

**What changed**
- **docs/INVARIANTS.md** added: formal lifecycle invariants (Chunk 1). Documents MUST/SHOULD/MUST NOT rules for core lifecycle, reconciliation, completion time, locking, audit/timeline, and UI disablement; violation examples; enforcement points (file/function refs); test checklist (~10 tests). No code changes.

---

## Doc refresh (completion time + needsReconcile) — 2026-02-28

**What changed**
- **Completion time (completedAt):** Single-source rule in `patchAttemptByRunId` (lib/requests/runsModel.ts): if existing.completedAt is set it is kept; else when `status === "completed"` use `completed_at ?? updated_at`. The GitHub Actions run API (GET run by id) returns `updated_at`, not `completed_at`, so completion time for audit and duration comes from `updated_at` when the run is completed.
- **needsReconcile:** Now true when runId is present and **either** conclusion **or** completedAt is missing (allows backfilling completedAt for attempts that have conclusion but no completion timestamp). Reconcile run fetch uses `bypassCache: true` so payload is fresh.
- **REQUEST_LIFECYCLE.md:** Plan row and Webhook loss/Repair bullets updated for completion-time rule and needsReconcile (conclusion or completedAt missing).
- **WEBHOOKS_AND_CORRELATION.md:** Patching run state describes completedAt single-source and monotonic completedAt; sync section describes needsReconcile (conclusion or completedAt missing), bypassCache for reconcile fetch, and completion from updated_at.
- **GLOSSARY.md:** Repair "When" uses needsReconcile (runId present, conclusion or completedAt missing).
- Run execution and Match bullets updated for completedAt from completed_at ?? updated_at and needsReconcile (conclusion or completedAt missing), bypassCache.
- **OPERATIONS.md:** Stuck-state table and re-sync bullet use needsReconcile (runId present, conclusion or completedAt missing).

---

## Doc refresh (request lock / expired) — 2026-02-28

**What changed**
- **Request lock:** Expired locks are treated as inactive (UI: `isLockActive`; backend: `acquireLock` already did not throw). Sync clears expired `request.lock` and persists; with `DEBUG_WEBHOOKS=1` sync logs `event=sync.lock_cleared_expired`. Validation script: `npm run validate:lock` (**scripts/validate-lock-expired.ts**).
- **REQUEST_LIFECYCLE.md:** New failure-mode row "Request lock (stale/expired)".
- **WEBHOOKS_AND_CORRELATION.md:** Sync section notes lock clearing and debug log.
- **GLOSSARY.md:** New "Request lock" subsection (active vs expired, sync clearing).
- Request lock bullet; DEBUG_WEBHOOKS extended with sync.lock_cleared_expired.

---

## Doc refresh (correctness invariants / alignment) — 2026-02-28

**What changed**
- **Audit:** Aligned all docs to current platform invariants: needsReconcile (runId + no conclusion), apply/destroy in-flight and stale destroy (terminality from conclusion; no status stored), sync noop cooldown (60s, in-memory), single global SSE in root layout, debounced list mutate (300ms).
- **SYSTEM_OVERVIEW.md:** Sync bullet uses needsReconcile; SSE table row describes global subscriber + 300ms debounce; new **Correctness guarantees** section (facts-only, monotonic patching, attempts-first, reconciliation invariant, cooldown guard, SSE-driven freshness, stale destroy guard).
- **REQUEST_LIFECYCLE.md:** Derivation rules (runId + no conclusion; stale = threshold); failure-mode and repair bullets use needsReconcile; noop cooldown mentioned.
- **WEBHOOKS_AND_CORRELATION.md:** Sync/reconciliation uses needsReconcile; noop cooldown noted.
- **OPERATIONS.md:** Stuck-state table and re-sync guidance use needsReconcile; list row describes SSE-driven revalidation (300ms debounce).
- **GLOSSARY.md:** Repair "When" uses needsReconcile.
- Run execution bullet (needsReconcile + cooldown); SSE revalidation (global subscriber, 300ms debounce); note that example JSON status is derived, not stored.
- **README.md**, **SCREAMING_ARCHITECTURE.md:** UI/SSE bullets updated (global SSE, 300ms debounce).
- **DOCS_INDEX.md:** Lifecycle/sync refresh line already referenced needsReconcile; no further change.
- **STATUS_WORKFLOW_SPIKE.md:** Unchanged (historical context preserved).
- No code changes; docs only.

---

## Doc refresh (observability / Insights) — 2026-02-28

**What changed**
- **SYSTEM_OVERVIEW.md:** Added **Observability and Insights** section: Insights page, ops metrics (cached), GitHub API usage (in-memory, single call-site, 5m/60m windows, top/hot routes, rate-limit burst, kindGuess, last rate-limit events), and `lib/observability` roles.
- **GLOSSARY.md:** Added **Observability** subsection: Insights, GitHub API usage metrics, rate-limit burst (5m), kindGuess.
- **SCREAMING_ARCHITECTURE.md:** Expanded `lib/observability/` bullet to mention ops-metrics, github-metrics, top/hot routes, rate-limit events, kindGuess, and Insights hooks.
- No code changes; docs only.

---

## PR summary (docs cleanup refresh)

**What changed**
- Added **docs/DOCS_INDEX.md** with full inventory and status (KEEP / UPDATE / MERGE / ARCHIVE / DELETE).
- Created canonical set: **SYSTEM_OVERVIEW.md** (updated), **REQUEST_LIFECYCLE.md**, **GITHUB_WORKFLOWS.md**, **WEBHOOKS_AND_CORRELATION.md**, **OPERATIONS.md**, **GLOSSARY.md**; **RUN_INDEX.md** (cross-links added).
- **README.md** shortened: “What is TfPilot”, core invariants, quickstart, links to DOCS_INDEX and key docs. Status wording aligned to derived canonical statuses (`applied` not `complete`).
- **SYSTEM_OVERVIEW.md** given a one-line pointer to DOCS_INDEX. **.cursor/rules/agent-routing.mdc** now references DOCS_INDEX.

**Doc refresh (lifecycle/sync/webhooks):** Plan attempt always created at dispatch (runId optional); sync fetches/patches when **needsReconcile(attempt)** (runId present, conclusion missing); webhook can attach runId by head_sha; DEBUG_WEBHOOKS=1 noop_reason logging. REQUEST_LIFECYCLE, WEBHOOKS_AND_CORRELATION, RUN_INDEX, OPERATIONS, GITHUB_WORKFLOWS, GLOSSARY, SYSTEM_OVERVIEW updated. Refs: `getCurrentAttemptStrict`, `persistDispatchAttempt`, `needsReconcile` in lib/requests/runsModel.ts.

**Doc refresh (UI):** Lifecycle History timeline: chronological order (request_created first), dedupe completion events by runId+attempt, "Apply Succeeded" → "Deployment Succeeded", runId and project/targetRepo links (buildLink: runId → GitHub actions run URL; project/targetRepo → repo root; PR link only for prNumber/pr keys to avoid project→pull bug). Timeline details use 2–3 column grid. Run index bullet fixed: `persistDispatchAttempt` in runsModel (not persistWorkflowDispatch).

**Archived / deleted**
- **Archived** (moved to **docs/archive/** with “ARCHIVED — 2026-02-26” header and replacement link): LIFECYCLE_MODEL_V2, EXECUTION_PLAN_V2, WEBHOOK_NEW_FEATURE_PLAN, Replace Polling with SSE + Event-Driven Sync, GITHUB_CALL_GRAPH_AUDIT, DESTROY_CLEANUP_FLOW_AUDIT, ACTION_CONSISTENCY_AUDIT, STATUS_TRANSITION_AUDIT, UI_STATE_LIFECYCLE_UX_AUDIT, UPDATE_CONFIGURATION_FLOW_AUDIT, ARCHITECTURE_REVIEW_REPORT, PLATFORM_REVIEW_FOR_AGENT, AUTH_GAPS_AUDIT_AND_FIX_PLAN, TIER1_SECURITY_HARDENING, ENTERPRISE_COST_ANALYSIS, PLATFORM_FULL_AUDIT_REPORT (root).
- **Deleted** originals after creating archive stubs (full content for LIFECYCLE_MODEL_V2 and EXECUTION_PLAN_V2; stub + “see git history” for large audits to avoid duplication).

**Mismatches found and fixed (docs only)**
- README and status wording: “complete” → “applied” to match **lib/status/status-config.ts** and **deriveLifecycleStatus**.
- Concurrency description: apply/destroy use **env-scoped state group** (e.g. `payments-terraform-state-dev`), not per-request; plan uses per-request group. Documented in GITHUB_WORKFLOWS.md and README.
- Sync/repair: documented that repair is GET sync with `?repair=1` or `?hydrate=1` and that `needsRepair(request)` gates GitHub calls; run index and RunId guard documented in WEBHOOKS_AND_CORRELATION.md.
- No code changes; docs-only.

| File | Purpose | Status | Replacement / notes | Last updated (best-effort) |
|------|---------|--------|----------------------|----------------------------|
| **Root** | | | | |
| `README.md` | What is TfPilot, invariants, quickstart, links | **KEEP** | — | Current |
| **Canonical docs** | | | | |
| `docs/SYSTEM_OVERVIEW.md` | Architecture, components, data model, invariants | **KEEP** | — | Current |
| `docs/SCREAMING_ARCHITECTURE.md` | Codebase layout by domain (app/lib/components); what the structure “screams” | **KEEP** | — | Current |
| `docs/REQUEST_LIFECYCLE.md` | E2E lifecycle, status derivation, failure modes, retry/repair | **KEEP** | — | New |
| `docs/GITHUB_WORKFLOWS.md` | Workflows per repo, concurrency, inputs, artifacts | **KEEP** | — | New |
| `docs/WEBHOOKS_AND_CORRELATION.md` | Webhook types, correlation order, runId guard, idempotency | **KEEP** | — | New |
| `docs/RUN_INDEX.md` | Run index: kinds, key format, value schema, retention | **KEEP** | — | Current |
| `docs/OPERATIONS.md` | Recovery playbook: stuck states, repair, re-sync, rebuild index, verify Postgres, failure scenarios | **KEEP** | — | Current |
| `docs/POSTGRES_INDEX.md` | Postgres requests_index schema, doc_hash, write-through, drift, list_errors, rebuild/prune | **KEEP** | — | Current |
| `docs/API.md` | GET /api/requests (cursor, list_errors, drift), GET /api/health/db, DB-optional behavior | **KEEP** | — | Current |
| `docs/INVARIANTS.md` | Formal lifecycle invariants (MUST/SHOULD/MUST NOT), violation examples, enforcement points, test checklist | **KEEP** | — | Current |
| `docs/POLLING.md` | Request-detail polling env vars and behavior | **KEEP** | — | Current |
| `docs/GLOSSARY.md` | Terminology: workflow kinds, statuses, Repair, observability | **KEEP** | — | Current |
| `docs/INSIGHTS.md` | Insights dashboard: ops metrics, GitHub API usage, API, code layout | **KEEP** | — | Current |
| `docs/RBAC.md` | Role-based access control: roles, permissions, allowlists, API enforcement | **KEEP** | — | Current |
| `docs/ORGANISATIONS.md` | Org tenancy: membership, add member (write flow), roles, org switcher | **KEEP** | — | Current |
| `docs/DRIFT_DETECTION.md` | Infrastructure drift: env-scoped (UI) and request-level (scheduled), APIs, workflows | **KEEP** | — | Current |
| **Roadmap / agent** | | | | |
| `docs/prompts/MASTER.md` | Master system prompt (referenced by .cursor rules) | **KEEP** | — | Current |
| `docs/prompts/agents/*-agent.md` | Role-specific agent prompts (naming: *-agent) | **KEEP** | — | Current |
| `docs/prompts/design/*.md` | UI/Internal design prompts | **KEEP** | — | Current |
| **Reference / optional** | | | | |
| `docs/USEFUL_COMMANDS.md` | Quick reference: dev, Postgres, webhook tunnel, tests, health | **KEEP** | — | Current |
| `docs/forensics/FORENSIC_STORAGE_INVARIANTS_REPORT.md` | Read-only storage model mapping (S3 prefixes, read/write sites) | **KEEP** | — | Reference |
| **Plans and deltas** (`docs/plans-and-deltas/`) | | | | |
| `docs/plans-and-deltas/ARCHITECTURE_DELTA_DB.md` | Design doc for Postgres index migration; canonical schema/behavior in POSTGRES_INDEX | **KEEP** | `docs/POSTGRES_INDEX.md` for current state | Reference |
| `docs/plans-and-deltas/ARCHITECTURE_DELTA_ENVIRONMENTS.md` | Design/proposal: first-class Environment entity, env-centric UX; legacy Model 1 | **KEEP** | Current: SYSTEM_OVERVIEW, ENVIRONMENT_TEMPLATES_DELTA | Reference (design) |
| `docs/plans-and-deltas/ENVIRONMENT_TEMPLATES_DELTA.md` | Architecture delta: Environment Templates, Deploy Environment | **KEEP** | — | Current (Phases 0–6 implemented) |
| `docs/plans-and-deltas/ENVIRONMENT_TEMPLATES_IMPLEMENTATION_PLAN.md` | Phase-by-phase implementation plan | **KEEP** | — | Current (Phases 0–6 complete) |
| `docs/plans-and-deltas/ARCHITECTURE_DELTA_ORG_SUPPORT.md` | Design doc for org (tenant) support | **KEEP** | — | Reference |
| `docs/plans-and-deltas/ORG_SUPPORT_IMPLEMENTATION_PLAN.md` | Incremental implementation plan for org support | **KEEP** | — | Reference |
| `docs/plans-and-deltas/ARCHITECTURE_DELTA_ENV_TEMPLATES_*.md` | Env templates UI, S3 resolution, parity design docs | **KEEP** | — | Reference |
| `docs/plans-and-deltas/ENV_TEMPLATES_*_IMPLEMENTATION_PLAN.md` | Env templates UI, S3 resolution, parity implementation plans | **KEEP** | — | Reference |
| `docs/plans-and-deltas/ENVIRONMENTS_IMPLEMENTATION_PLAN.md` | Environments feature implementation plan | **KEEP** | — | Reference |
| `docs/PLATFORM_BENCHMARKS.md` | Benchmarks | **KEEP** | — | Optional reference |
| `docs/STATUS_WORKFLOW_SPIKE.md` | Spike: status derivation, list vs detail, apply/sync; no code changes | **KEEP** | — | Investigation only |
| **Archived** (moved to `docs/archive/`) | | | | |
| `docs/LIFECYCLE_MODEL_V2.md` | Design doc for derived lifecycle | **ARCHIVE** | `docs/REQUEST_LIFECYCLE.md` | Superseded by code + REQUEST_LIFECYCLE |
| `docs/EXECUTION_PLAN_V2.md` | Roadmap v2 | **ARCHIVE** | — | Removed (EXECUTION_PLAN retired) |
| `docs/WEBHOOK_NEW_FEATURE_PLAN.md` | Webhook feature plan | **ARCHIVE** | `docs/WEBHOOKS_AND_CORRELATION.md` | Implemented |
| `Replace Polling with SSE + Event-Driven Sync` | SSE migration plan | **ARCHIVE** | Implemented (webhook + SSE) | Implemented |
| `docs/GITHUB_CALL_GRAPH_AUDIT.md` | GitHub API call audit | **ARCHIVE** | — | Reference only |
| `docs/DESTROY_CLEANUP_FLOW_AUDIT.md` | Destroy/cleanup E2E audit | **ARCHIVE** | `docs/REQUEST_LIFECYCLE.md`, `docs/GITHUB_WORKFLOWS.md` | Reference only |
| `docs/ACTION_CONSISTENCY_AUDIT.md` | Approve/Merge/Apply/Destroy consistency | **ARCHIVE** | — | Reference only |
| `docs/STATUS_TRANSITION_AUDIT.md` | Status transition deep dive | **ARCHIVE** | `docs/REQUEST_LIFECYCLE.md`, `lib/requests/deriveLifecycleStatus.ts` | Code is source of truth |
| `docs/UI_STATE_LIFECYCLE_UX_AUDIT.md` | UI state/lifecycle UX | **ARCHIVE** | — | Reference only |
| `docs/UPDATE_CONFIGURATION_FLOW_AUDIT.md` | Update configuration flow | **ARCHIVE** | — | Reference only |
| `docs/ARCHITECTURE_REVIEW_REPORT.md` | Full architecture audit | **ARCHIVE** | `docs/SYSTEM_OVERVIEW.md` | Long; overview is canonical |
| `docs/PLATFORM_REVIEW_FOR_AGENT.md` | Agent-facing platform review | **ARCHIVE** | `docs/SYSTEM_OVERVIEW.md`, `docs/REQUEST_LIFECYCLE.md` | Merged into canonical |
| `docs/AUTH_GAPS_AUDIT_AND_FIX_PLAN.md` | Auth gaps audit | **ARCHIVE** | — | Reference only |
| `docs/TIER1_SECURITY_HARDENING.md` | Security baseline plan | **ARCHIVE** | — | Reference only |
| `docs/ENTERPRISE_COST_ANALYSIS.md` | Enterprise cost analysis | **ARCHIVE** | — | Not ops runbook |
| `PLATFORM_FULL_AUDIT_REPORT.md` (root) | Full platform audit | **ARCHIVE** | `docs/SYSTEM_OVERVIEW.md`, `docs/REQUEST_LIFECYCLE.md`, etc. | Folding into canonical |

No `architecture/`, `design/`, or `notes/` top-level folders exist; design lives under `docs/prompts/design/`.
