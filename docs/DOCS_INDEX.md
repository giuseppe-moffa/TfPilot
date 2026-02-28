# TfPilot documentation index

Canonical docs only. For archived/retired docs see `docs/archive/`.

---

## PR summary (docs cleanup refresh)

**What changed**
- Added **docs/DOCS_INDEX.md** with full inventory and status (KEEP / UPDATE / MERGE / ARCHIVE / DELETE).
- Created canonical set: **SYSTEM_OVERVIEW.md** (updated), **REQUEST_LIFECYCLE.md**, **GITHUB_WORKFLOWS.md**, **WEBHOOKS_AND_CORRELATION.md**, **OPERATIONS.md**, **GLOSSARY.md**; **RUN_INDEX.md** (cross-links added).
- **README.md** shortened: “What is TfPilot”, core invariants, quickstart, links to DOCS_INDEX and key docs. Status wording aligned to derived canonical statuses (`applied` not `complete`).
- **EXECUTION_PLAN.md** and **SYSTEM_OVERVIEW.md** given a one-line pointer to DOCS_INDEX. **.cursor/rules/agent-routing.mdc** now references DOCS_INDEX.

**Doc refresh (lifecycle/sync/webhooks):** Plan attempt always created at dispatch (runId optional); sync always fetches/patches when current attempt has runId and status queued/in_progress; webhook can attach runId by head_sha; DEBUG_WEBHOOKS=1 noop_reason logging. REQUEST_LIFECYCLE, WEBHOOKS_AND_CORRELATION, RUN_INDEX, OPERATIONS, GITHUB_WORKFLOWS, GLOSSARY, SYSTEM_OVERVIEW, CONTEXT_PACK updated. Refs: `getCurrentAttemptStrict`, `persistDispatchAttempt` in lib/requests/runsModel.ts.

**Doc refresh (UI):** Lifecycle History timeline: chronological order (request_created first), dedupe completion events by runId+attempt, "Apply Succeeded" → "Deployment Succeeded", runId and project/targetRepo links (buildLink: runId → GitHub actions run URL; project/targetRepo → repo root; PR link only for prNumber/pr keys to avoid project→pull bug). Timeline details use 2–3 column grid. CONTEXT_PACK Run index bullet fixed: `persistDispatchAttempt` in runsModel (not persistWorkflowDispatch).

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
| `docs/OPERATIONS.md` | Recovery playbook: stuck states, repair, re-sync, dev reset | **KEEP** | — | New |
| `docs/POLLING.md` | Request-detail polling env vars and behavior | **KEEP** | — | Current |
| `docs/GLOSSARY.md` | Terminology: workflow kinds, statuses, Repair | **KEEP** | — | New |
| `docs/CONTEXT_PACK.md` | New-chat context pack: paste into new thread for lifecycle/webhook/SSE debugging | **KEEP** | — | New |
| **Roadmap / agent** | | | | |
| `docs/EXECUTION_PLAN.md` | Roadmap, phases, principles (referenced by .cursor rules) | **KEEP** | — | Current |
| `docs/prompts/MASTER.md` | Master system prompt (referenced by .cursor rules) | **KEEP** | — | Current |
| `docs/prompts/agents/*-agent.md` | Role-specific agent prompts (naming: *-agent) | **KEEP** | — | Current |
| `docs/prompts/design/*.md` | UI/Internal design prompts | **KEEP** | — | Current |
| **Reference / optional** | | | | |
| `docs/PLATFORM_BENCHMARKS.md` | Benchmarks | **KEEP** | — | Optional reference |
| **Archived** (moved to `docs/archive/`) | | | | |
| `docs/LIFECYCLE_MODEL_V2.md` | Design doc for derived lifecycle | **ARCHIVE** | `docs/REQUEST_LIFECYCLE.md` | Superseded by code + REQUEST_LIFECYCLE |
| `docs/EXECUTION_PLAN_V2.md` | Roadmap v2 | **ARCHIVE** | `docs/EXECUTION_PLAN.md` | Redundant with EXECUTION_PLAN |
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
