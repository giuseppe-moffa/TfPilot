# TfPilot — Internal Design

## System overview

TfPilot is an AI-assisted Terraform self-service platform. **AI collects inputs; templates generate Terraform.** Terraform runs only in GitHub Actions; the app orchestrates request lifecycle, S3 storage, and GitHub (PRs, workflow dispatch, webhooks). No AI-generated raw Terraform; no hidden state. Canonical docs: **docs/SYSTEM_OVERVIEW.md**, **docs/REQUEST_LIFECYCLE.md**, **docs/GITHUB_WORKFLOWS.md**, **docs/WEBHOOKS_AND_CORRELATION.md**, **docs/DOCS_INDEX.md**.

## Request lifecycle (high level)

1. **Create** — User selects project, environment, module; fills config (form or assistant). App persists request to S3, creates branch `request/<requestId>`, opens PR, dispatches plan. Run index written (runId → requestId).
2. **Plan** — Workflow runs `terraform plan -lock=false`; webhook/sync patch workflow facts. Status derived → planning → plan_ready.
3. **Approve / Merge** — Approval and merge recorded via API and/or webhooks; facts (`approval`, `mergedSha`, `pr`) updated.
4. **Apply** — User triggers apply; workflow runs; run index + webhook/sync update apply run. Status → applying → applied (or failed).
5. **Destroy** (optional) — Cleanup workflow strips tfpilot blocks; destroy workflow runs. Request archived to `history/` on success.

**Status is derived only** (single entrypoint: `deriveLifecycleStatus`). Run state is stored in `request.runs.{plan,apply,destroy}` (attempt-based); webhooks and sync patch attempt records by runId. Webhooks and sync patch facts only; they do not write status.

## Sync and webhooks

- **Webhook-first:** GitHub sends pull_request, pull_request_review, workflow_run to `/api/github/webhook`. Handler correlates (run index first, then fallbacks), patches request via `patchRequestFacts` (PR/approval) or `patchRunsAttemptByRunId` (workflow_run → attempt record), appends to SSE stream.
- **Run index:** S3 `webhooks/github/run-index/<kind>/run-<runId>.json` for O(1) runId→requestId. Written on plan/apply/destroy dispatch.
- **Sync/repair:** GET `/api/requests/:id/sync` (optional `?repair=1`) fetches from GitHub when `needsRepair(request)` or forced; patches facts. No optimistic status.
- **SSE:** Server pushes events when a request doc is written; UI subscribes and revalidates SWR. Polling is fallback (see docs/POLLING.md).

## GitHub workflows

- **Concurrency:** Apply/destroy serialized per environment (state group); plan/cleanup per request. Plan and drift-plan use `-lock=false`.
- **Workflow kinds:** plan, apply, destroy, cleanup, drift_plan. Classification in lib/github/workflowClassification.ts (drift_plan before plan).
- **Inputs:** request_id, environment, ref, dry_run as applicable. Backend config (bucket, key, dynamodb_table) must match env backend.tf.

## Storage and invariants

- **S3:** Requests `requests/<id>.json`; history `history/<id>.json`; run index; stream state; lifecycle logs.
- **Invariants:** Only patch attempt matching runId; monotonic attempt updates (no regression of concluded attempts); status derived; SSE only on write; apply/destroy serialized per env.

## Security and RBAC

- Session-based auth; prod allowlists (TFPILOT_PROD_ALLOWED_USERS, TFPILOT_DESTROY_PROD_ALLOWED_USERS). RBAC: viewer, developer, approver, admin. Webhook: signature verification and delivery idempotency.

## Best practices

- **Facts only:** Patch only facts; never write optimistic status.
- **Single derivation:** Use `deriveLifecycleStatus(request)` everywhere for status.
- **Run index:** Write on dispatch so webhooks can correlate; preserve runId guard in patches.
- **Docs:** Prefer canonical docs (DOCS_INDEX) over ad-hoc descriptions. Keep agent prompts and design docs aligned with SYSTEM_OVERVIEW and REQUEST_LIFECYCLE.
