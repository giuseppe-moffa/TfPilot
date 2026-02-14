# TfPilot SYSTEM OVERVIEW

## What TfPilot Is

TfPilot is a Terraform self-service platform that turns guided user requests into deterministic Terraform changes delivered through GitHub pull requests and executed via GitHub Actions.

**Core promise:** “AI collects inputs, templates generate Terraform.”

---

## High-Level Flow

1. User selects **project + environment + module** in the UI.
2. Chat agent gathers module inputs and produces **structured config JSON**.
3. TfPilot persists the request to **S3** (`requests/<requestId>.json`) using optimistic versioning.
4. TfPilot generates a bounded Terraform block into the target infra repo file(s) and opens a **PR**.
5. GitHub Actions runs **plan** and publishes output.
6. User (or approver) approves → merge → apply.
7. Optional: destroy triggers a cleanup PR, then destroy. Request is archived to `history/`.

---

## Repositories

### 1) Platform Repo (TfPilot App)
- **Next.js (App Router)** UI + API routes
- Responsible for:
  - auth/session validation
  - request orchestration
  - S3 request + chat log storage
  - GitHub PR creation + workflow dispatch
  - UI timeline and actions

### 2) Infra Repos (Per Project)
Examples: `core-terraform`, `payments-terraform`

- Contain:
  - `envs/dev|prod` root configurations
  - `modules/` catalogue (module source used by request blocks)
  - `.github/workflows` plan/apply/destroy/cleanup

TfPilot writes only bounded blocks into files like:
- `tfpilot.s3.tf`
- `tfpilot.sqs.tf`
- `tfpilot.ecs.tf`
- `tfpilot.misc.tf`

Each request is enclosed by:
- `# --- tfpilot:begin:<requestId> ---`
- `# --- tfpilot:end:<requestId> ---`

---

## Storage Model

### Requests Bucket
- `s3://<TFPILOT_REQUESTS_BUCKET>/requests/<requestId>.json`
- Destroyed requests archived to:
  - `history/<requestId>.json`
- Uses **optimistic locking** via a `version` field (increment-on-write semantics).

### Chat Logs Bucket
- `s3://<TFPILOT_CHAT_LOGS_BUCKET>/...`
- Enforced encryption (SSE-S3).

---

## Auth & Guardrails

### Session/Auth
- Session cookie validated in middleware
- API routes require valid session

### Prod Guardrail
- Production actions gated by:
  - `TFPILOT_PROD_ALLOWED_USERS` (GitHub usernames allow-list)
- Applies to: approve/merge/apply/destroy/cleanup dispatch

---

## Module Catalogue

### moduleRegistry (Single Source of Truth)
- Defines module types, UI display, required inputs and defaults
- Should drive:
  - UI module list/buttons
  - backend validation
  - config normalization schema (required/optional/defaults/strip/compute)

### Terraform Modules
- Stored in infra repos under:
  - `modules/<module-type>`
- Referenced from env roots with:
  - `source = "../../modules/<module-type>"` (from `envs/<env>`)

---

## GitHub Integration

### PR Automation
- Creates branch: `request/<requestId>`
- Commits Terraform file updates
- Opens PR against base branch (usually `main`)

### Workflow Dispatch
- Dispatches workflows via GitHub API:
  - Plan
  - Apply
  - Destroy
  - Cleanup

### Concurrency
- Shared concurrency per **project + env + request** to prevent overlapping runs and state locks.

---

## Workflows

### Plan
- `terraform init` with S3 backend + DynamoDB locking
- `terraform plan -no-color | tee plan.txt`
- Upload `plan.txt` as artifact
- Record run metadata back to request (runId/url/status/conclusion)

### Apply
- Requires merged PR
- Prod guarded
- Records run metadata back to request

### Cleanup
- Creates `cleanup/<requestId>` branch
- Removes only the TfPilot bounded block(s)
- Opens PR; can auto-merge in dev

### Destroy
- Runs cleanup first, then destroys resources
- Prod guarded
- Archives request to `history/`

---

## UI

### Main Views
- Requests table with filters: status/env/module/project/search
- Request detail page:
  - timeline
  - actions (approve/merge/apply/destroy/cleanup)
  - plan output (from artifact / PR run)
  - run links (Actions URLs)

### Polling
- SWR used for list and per-request refresh
- Requirement: avoid flicker by only updating a small status slice when fields change

---

## Observability

### Current
- UI polling for freshness
- Status surfaced for plan/apply/destroy and cleanup PR

### Gaps / Next
- Structured lifecycle event logs (JSON)
- Notifications (Slack/email)
- Health endpoint + metrics endpoint
- Drift detection

---

## Key Invariants

- Terraform is executed only in GitHub Actions (no local state in app).
- Requests are persisted in S3; UI derives state from request JSON + GitHub run status.
- TfPilot only edits bounded sections of infra files.
- Modules are deterministic; AI only collects inputs.
