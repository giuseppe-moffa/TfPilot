# TfPilot system overview

**Doc index:** [docs/DOCS_INDEX.md](DOCS_INDEX.md).

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
| **S3 request storage** | `requests/<requestId>.json` (optimistic `version`). Destroyed → `history/<requestId>.json`. Lifecycle logs `logs/<requestId>/<ts>.json`. Run index under `webhooks/github/run-index/<kind>/`. |
| **GitHub workflows** | Plan, apply, destroy, cleanup, drift_plan (infra repos). Dispatched by TfPilot; concurrency per env/state group. |
| **Webhooks** | `pull_request`, `pull_request_review`, `workflow_run` → correlate to request, patch facts only, push SSE event. |
| **SSE** | Server pushes `{ requestId, updatedAt }` on webhook patches so UI can revalidate without polling. |

---

## Data model (request shape)

- **Identity:** `id`, `version` (optimistic lock).
- **Target:** `targetOwner`, `targetRepo`, `branchName`, `targetFiles`, env/module/project.
- **PR:** `pr` or `github.pr` (number, url, merged, headSha, open).
- **Workflow runs:** `github.workflows.plan | apply | destroy | cleanup` (and legacy top-level `planRun`, `applyRun`, `destroyRun`): `runId`, `status`, `conclusion`, `headSha`, `url`, etc. `destroyTriggeredAt` for stale-destroy handling.
- **Approval:** `approval.approved`, `approval.approvers`.
- **Merge:** `mergedSha` (set by merge route).
- **Cleanup:** `cleanupPr`, `timeline` (steps including Cleanup PR opened/merged).
- **Status:** Not stored authoritatively; derived by `deriveLifecycleStatus(request)` (see REQUEST_LIFECYCLE.md).

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
