# TfPilot system overview

**Doc index:** [docs/DOCS_INDEX.md](DOCS_INDEX.md). For codebase layout by domain (what the structure “screams”), see [docs/SCREAMING_ARCHITECTURE.md](SCREAMING_ARCHITECTURE.md).

## What TfPilot is

TfPilot is a Terraform self-service platform that turns guided user requests into deterministic Terraform changes delivered through GitHub pull requests and executed via GitHub Actions.

**Core promise:** “AI collects inputs, templates generate Terraform.”

---

## Architecture (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│                     TfPilot (Next.js)                             │
│  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ App Router │  │ API Routes │  │ Auth       │  │ SSE stream  │  │
│  │ (pages)    │  │ (requests, │  │ (session,  │  │ (updates)   │  │
│  │            │  │  github,   │  │  roles)    │  │             │  │
│  │            │  │  sync)     │  │            │  │             │  │
│  └─────┬──────┘  └─────┬─────┘  └─────┬──────┘  └──────┬──────┘  │
│        │                │              │                │         │
│        └────────────────┼──────────────┼────────────────┘         │
│                          │              │                          │
│  ┌───────────────────────┴──────────────┴───────────────────────┐│
│  │  S3 (requests bucket)                                         ││
│  │  requests/<id>.json  history/<id>.json  logs/  run-index/     ││
│  └───────────────────────────────┬──────────────────────────────┘│
└──────────────────────────────────┼─────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │  GitHub                  │                         │
        │  PRs, branches, workflow_run / pull_request       │
        │  webhooks → POST /api/github/webhook              │
        │  Actions: plan, apply, destroy, cleanup, drift_plan│
        └──────────────────────────────────────────────────┘
```

---

## Components

| Component | Role |
|-----------|------|
| **Next.js UI** | Request list (filters, dataset modes), request detail (timeline, actions, plan diff), new request form, assistant. SWR + optional SSE for freshness. |
| **API routes** | Request CRUD, sync (repair/hydrate), approve, merge, apply, destroy, webhook receiver, drift-eligible/drift-result, assistant state, logs. |
| **S3 request storage** | `requests/<requestId>.json` (optimistic `version`). Destroyed → `history/<requestId>.json`. Lifecycle logs `logs/<requestId>/<ts>.json`. Run index: `webhooks/github/run-index/<kind>/` (see **docs/RUN_INDEX.md**). |
| **GitHub workflows** | Plan, apply, destroy, cleanup, drift_plan (infra repos). Dispatched by TfPilot; concurrency per env/state group. |
| **Webhooks** | `pull_request`, `pull_request_review`, `workflow_run` → correlate to request, patch facts only, push SSE event. |
| **SSE** | Server pushes `{ requestId, updatedAt }` on webhook patches so UI can revalidate without polling. |

---

## Data model (request shape)

- **Identity:** `id`, `version` (optimistic lock).
- **Target:** `targetOwner`, `targetRepo`, `branchName`, `targetFiles`, env/module/project.
- **PR:** `pr` or `github.pr` (number, url, merged, headSha, open).
- **Run execution:** All workflow execution state lives under `request.runs` (plan, apply, destroy). See **Run execution model** below.
- **Approval:** `approval.approved`, `approval.approvers`.
- **Merge:** `mergedSha` (set by merge route).
- **Cleanup:** `cleanupPr`, `timeline` (steps including Cleanup PR opened/merged).
- **Status:** Not stored authoritatively; derived by `deriveLifecycleStatus(request)` (see REQUEST_LIFECYCLE.md).

---

## Run execution model

All workflow execution state is stored under `request.runs`. There is no legacy run state (no top-level run fields or `github.workflows` run state).

```ts
request.runs = {
  plan:   { currentAttempt: number, attempts: AttemptRecord[] },
  apply:  { currentAttempt: number, attempts: AttemptRecord[] },
  destroy: { currentAttempt: number, attempts: AttemptRecord[] }
}
```

**AttemptRecord** (per attempt):

| Field | Type | Description |
|-------|------|-------------|
| `attempt` | number | 1-based attempt index |
| `runId` | number | GitHub Actions run ID |
| `url` | string | Run URL |
| `status` | string | `"queued"` \| `"in_progress"` \| `"completed"` \| `"unknown"` |
| `conclusion` | string? | `"success"` \| `"failure"` \| `"cancelled"` \| etc. |
| `dispatchedAt` | string | ISO timestamp when dispatch occurred |
| `completedAt` | string? | ISO timestamp when run completed |
| `headSha` | string? | Commit SHA (plan) |
| `actor` | string? | Who triggered (apply/destroy) |

**Current attempt:** The latest attempt for each kind is the one where `attempt === currentAttempt`. Helpers: `getCurrentAttemptStrict(request.runs, "plan"|"apply"|"destroy")` in **lib/requests/runsModel.ts**. Attempts may have optional `runId`/url (e.g. plan attempt created at dispatch before runId is known); webhook/sync can attach runId by matching head_sha.

- **Dispatch:** Plan/apply/destroy routes call `persistDispatchAttempt(...)` to append a new attempt (status `queued`, headSha/ref/actor; runId/url when available) and write the run index when runId is known. Plan attempt is always created at dispatch.
- **Webhook:** `workflow_run` events are correlated via run index (or head_sha for attempts without runId); the matching attempt is patched (runId/url, status, conclusion, completedAt, headSha). No other run state is written.
- **Sync:** GET sync **always** fetches GitHub run status when the current attempt has runId and status queued/in_progress, and patches that attempt. Also runs when `needsRepair(request)` or `?repair=1` (e.g. to resolve missing runId). No canonicalization or legacy repair.
- **Retry:** A retry (e.g. “Retry apply”) creates a new attempt (attempt 2, 3, …); `currentAttempt` moves to the new attempt.

---

## Execution integrity principles

- **Single canonical run model** — Only `request.runs.{plan,apply,destroy}` hold execution state; no dual-write, no legacy fields.
- **Attempt-based execution** — Each dispatch adds an attempt; lifecycle and UI use the current attempt only.
- **Idempotent dispatch** — Dispatch routes use idempotency keys; replay returns existing run info from current attempt.
- **RunId-based correlation** — Run index (S3) maps runId → requestId; webhooks resolve request then patch the attempt with that runId.
- **Webhook-first with reconcile fallback** — Webhooks patch attempts; sync reconciles when needed (e.g. missed webhook) by fetching GitHub and patching the same attempt.
- **Derived state from facts only** — Status is always derived by `deriveLifecycleStatus(request)` from PR, approval, mergedSha, and current attempts; never stored as authoritative.

---

## Repositories

- **Platform repo (TfPilot):** This app. Next.js, API, S3, GitHub API, webhooks, SSE.
- **Infra repos (per project):** e.g. `core-terraform`, `payments-terraform`. Contain `envs/dev|prod`, `modules/`, `.github/workflows` (plan, apply, destroy, cleanup, drift-plan). TfPilot writes only bounded blocks between `# --- tfpilot:begin:<requestId> ---` and `# --- tfpilot:end:<requestId> ---`.

---

## Invariants

- Terraform runs **only** in GitHub Actions.
- Requests are persisted in S3; no hidden local state.
- TfPilot edits only content between tfpilot markers.
- Status is **derived** from facts (PR, runs, approval); webhooks and sync patch **facts**, not status.
- GitHub is the execution boundary and source of truth for runs.

---

## Glossary

See **docs/GLOSSARY.md** for workflow kinds, canonical statuses, and Repair.
