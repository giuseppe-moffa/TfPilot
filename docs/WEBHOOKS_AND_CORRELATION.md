# Webhooks and correlation

GitHub sends events to `POST /api/github/webhook`. Handler verifies signature, checks delivery idempotency, correlates event to a request, then patches **facts only** (no status write). Implementation: **app/api/github/webhook/route.ts**, **lib/requests/patchRequestFacts.ts**.

---

## Webhook types handled

| Event | Action |
|-------|--------|
| **pull_request** | Correlate by PR branch/title → requestId. Patch `github.pr` (open, merged, headSha, url, number). Append SSE event. |
| **pull_request_review** | Correlate by PR → requestId. Patch `approval` (approved, approvers) from review state. Append SSE event. |
| **workflow_run** | Classify kind (plan, apply, destroy, cleanup, drift_plan) via `classifyWorkflowRun`. Correlate (see below), then **patch the matching attempt** in `request.runs[kind]` by runId (`patchRunsAttemptByRunId`). On destroy success, optionally trigger cleanup dispatch. Append SSE event when patch applied. |

---

## Correlation order (workflow_run)

1. **Run index (O(1))** — `getRequestIdByRunId(kind, runId)` from S3 `webhooks/github/run-index/<kind>/run-<runId>.json`. Used first for all kinds when `kind` and `workflow_run.id` are present.
2. **Destroy fallback** — If kind is `destroy` and index miss: `getRequestIdByDestroyRunId(runId)` (list-based scan of requests’ destroy attempts).
3. **Branch/title correlation** — `correlateWorkflowRun(payload)`: branch ref, workflow name/inputs, PR number, etc.

Result: requestId or null. If null, delivery is recorded and 200 returned; no patch.

---

## Patching run state (attempts only)

Execution state lives only in `request.runs.{plan,apply,destroy}`. Attempts may exist **without runId** (e.g. plan attempt created at dispatch before runId is known). For each `workflow_run` event:

1. Resolve requestId (run index first, then fallbacks).
2. Call `patchRunsAttemptByRunId(current, kind, payload)`: it finds the **attempt** in `request.runs[kind].attempts` whose `runId === workflow_run.id` and updates that attempt’s status, conclusion, completedAt, headSha. If no attempt matches by runId but an attempt exists with matching `head_sha` and no runId, the webhook attaches runId/url to that attempt then patches status/conclusion.
3. Monotonic rules: do not overwrite a completed attempt with in_progress/queued; do not clear conclusion. Duplicate status/conclusion for same runId returns no-op so no redundant S3 write.
4. When the patch returns no change, the webhook logs `event=webhook.patch.noop`. With `DEBUG_WEBHOOKS=1`, incoming event, correlation path (index hit/miss, fallback), patch result (hasChanges, saved), and noop_reason (from `patchRequestFacts`) are logged for debugging.

There is no legacy run state. No canonicalization or “repair” of legacy fields exists; only attempt records are updated.

---

## Idempotency

- **Delivery idempotency:** `X-GitHub-Delivery` is checked via `hasDelivery(deliveryId)`. If already seen, respond `{ duplicate: true }` and do not process.
- **Patch idempotency:** If `patchRunsAttemptByRunId` produces no change (status, conclusion, completedAt already match), it returns `{}`. Then `updateRequest(..., mutate)` receives `current => current` and performs **no S3 write**. No S3 write → no SSE append. So duplicate webhook deliveries do not cause redundant writes or SSE.

---

## Sync and reconciliation

GET `/api/requests/:id/sync` (with or without `?repair=1`) reconciles current attempts. **Critical rule:** For each kind (plan, apply, destroy), if the **current attempt exists, has runId, and status is queued or in_progress**, sync **always** fetches that run from the GitHub API and patches that attempt via `patchAttemptByRunId`. This happens even when `needsRepair(request)` is false and without `?repair=1`, so "stuck destroying" (or planning/applying) converges when the UI polls sync. Sync also runs when `needsRepair(request)` or `?repair=1` for PR/reviews/cleanup and for resolving missing runId (e.g. plan attempt created without runId: sync can resolve runId from the workflow runs list and patch). Sync does not increment currentAttempt or create new attempts; it only refreshes existing attempt records. No canonicalization or legacy repair.

---

## Cleanup dispatch from webhook

When `workflow_run` is destroy and status is completed with conclusion success, the webhook may trigger cleanup dispatch (if not already dispatched for this destroy run). Uses `GITHUB_SERVER_TOKEN`. Sync with `?repair=1` can retry cleanup dispatch if it previously failed.
