# Drift Detection

This document describes how TfPilot detects **infrastructure drift** — when live AWS/resources have diverged from the desired state in Terraform. It covers both environment-scoped drift (TfPilot UI) and request-level drift (scheduled checks, optional).

---

## Overview

**Drift** = live infrastructure ≠ Terraform desired state. Terraform detects drift by running `terraform plan` against the base branch; a non-empty plan indicates drift.

TfPilot supports two drift flows:

| Flow | Scope | Trigger | Primary use |
|------|-------|---------|-------------|
| **Environment drift** | Whole env root (`envs/<key>/<slug>/`) | Manual from env page | On-demand drift check per environment |
| **Request-level drift** | Per-request (optional) | Scheduled (`drift-check.yml`) | Nightly drift checks for dev requests |

---

## Environment drift (TfPilot UI)

### Flow

1. User opens environment detail page → clicks **"Run Drift Plan"**
2. TfPilot calls `POST /api/github/drift-plan` with `{ environment_id }`
3. App dispatches `drift_plan` workflow to the infra repo (base branch)
4. Workflow runs `terraform plan` at `envs/<environment_key>/<environment_slug>/`
5. Run ID is resolved and written to env drift index
6. UI shows last drift run via `GET /api/environments/:id/drift-latest`

### API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `POST /api/github/drift-plan` | POST | Session + GitHub | Dispatch drift plan for environment |
| `GET /api/environments/:id/drift-latest` | GET | Session + GitHub | Last drift run for environment |

### Workflow

- **File:** `drift_plan.yml` (or `GITHUB_DRIFT_PLAN_WORKFLOW_FILE`)
- **Inputs:** `environment_key`, `environment_slug`
- **Ref:** Default branch (e.g. `main`)
- **Steps:** Checkout → AWS OIDC → `terraform init` → `terraform plan -detailed-exitcode`
- **Artifacts:** `drift-logs-v2` (plan.txt), `drift-plan-json-v2` (plan.json)
- **Concurrency:** Same group as apply/destroy per env

### Env drift index (S3)

- **Purpose:** Map drift run ID → environment for "last drift" display
- **Prefix:** `webhooks/github/env-drift/`
- **Keys:** `run-<runId>.json`, `by-env/<environmentId>.json`
- **Pruning:** 30 days TTL (`ENV_DRIFT_PRUNING_TTL_DAYS`)
- **Code:** `lib/github/envDriftRunIndex.ts`

---

## Request-level drift (scheduled / optional)

Some infra repos run a scheduled workflow that:

1. Calls `GET /api/requests/drift-eligible` (with `X-TfPilot-Secret`) to list eligible requests
2. Filters by project
3. Dispatches drift workflow per request (inputs vary by repo)
4. Workflow (or post-step) calls `POST /api/requests/:requestId/drift-result` to record result

### Eligibility (drift-eligible)

A request is eligible when:

- **Environment:** `environment_key === "dev"` only
- **Status:** Applied (or current apply attempt success)
- **Not destroyed** (status ≠ destroyed/destroying)
- **Not active** (no plan/apply in progress or queued)

### API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/requests/drift-eligible` | GET | `X-TfPilot-Secret` header | List eligible dev requests for drift check |
| `POST /api/requests/:requestId/drift-result` | POST | `X-TfPilot-Secret` header | Record drift result per request |

### drift-result payload

```json
{
  "runId": 123456789,
  "runUrl": "https://github.com/.../actions/runs/123456789",
  "hasDrift": true,
  "summary": "Optional text summary"
}
```

- **hasDrift:** `true` = drift detected, `false` = no drift
- Stored in `request.drift`: `{ status, lastCheckedAt, runId, runUrl, summary }`
- Lifecycle events: `drift_check_started`, `drift_detected`, `drift_cleared`

### Security

- **`TFPILOT_WEBHOOK_SECRET`** — Required for drift-eligible and drift-result. Header: `X-TfPilot-Secret`.
- **Rate limit:** drift-eligible: 30 req/min per IP (in-memory; use Redis for multi-instance).
- Constant-time secret comparison to prevent timing attacks.

---

## Infra repo workflows

### drift-check.yml (optional)

- **Trigger:** Schedule (e.g. daily 2 AM) or `workflow_dispatch`
- **Steps:**
  1. Call TfPilot `/api/requests/drift-eligible` with secret
  2. Filter by project (e.g. `core`, `payments`)
  3. Dispatch drift plan for each eligible request
- **Secrets:** `TFPILOT_API_URL`, `TFPILOT_WEBHOOK_SECRET`, `GITHUB_TOKEN`
- **Note:** Workflow inputs (`request_id`, `environment`) depend on repo. Model 2 repos use `environment_key` + `environment_slug` in `drift_plan.yml`.

### drift_plan.yml

- **Trigger:** `workflow_dispatch` (from TfPilot or drift-check)
- **Model 2 (env-scoped):** Inputs `environment_key`, `environment_slug`. Runs plan at `envs/<key>/<slug>/`.
- **Legacy (request-scoped):** Some repos may use `request_id`, `environment`; workflow would scope to a single request's module.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_DRIFT_PLAN_WORKFLOW_FILE` | Workflow filename (default `drift_plan.yml`) |
| `TFPILOT_WEBHOOK_SECRET` | Secret for drift-eligible and drift-result (optional; required if using scheduled drift) |

---

## Code references

| Component | Path |
|-----------|------|
| Drift plan dispatch | `app/api/github/drift-plan/route.ts` |
| Drift latest | `app/api/environments/[id]/drift-latest/route.ts` |
| Drift eligible | `app/api/requests/drift-eligible/route.ts` |
| Drift result | `app/api/requests/[requestId]/drift-result/route.ts` |
| Env drift index | `lib/github/envDriftRunIndex.ts` |
| Resolve run ID | `lib/github/resolveEnvDriftRunId.ts` |
| Dispatch inputs | `lib/github/dispatchDriftPlan.ts` |

---

## Terminology: index drift vs infrastructure drift

| Term | Meaning |
|------|---------|
| **Infrastructure drift** | Live resources ≠ Terraform state. Detected by `terraform plan`. This doc focuses on this. |
| **Index drift** | Postgres `doc_hash` ≠ S3 request document hash. Indicates index/projection out of sync. See [POSTGRES_INDEX.md](POSTGRES_INDEX.md). |

---

## Future

Per [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md): "Drift detection: Active drift status per environment; UI indicators" — not yet implemented. Current state: drift runs are triggered manually (env page) or by scheduled workflow; per-request drift status is stored when drift-result is called.

---

## See also

- [GITHUB_WORKFLOWS.md](GITHUB_WORKFLOWS.md) — Workflow kinds, concurrency, drift plan v2
- [RUN_INDEX.md](RUN_INDEX.md) — Run index and env drift index
- [POSTGRES_INDEX.md](POSTGRES_INDEX.md) — Index drift (different concept)
