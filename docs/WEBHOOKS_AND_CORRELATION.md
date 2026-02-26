# Webhooks and correlation

GitHub sends events to `POST /api/github/webhook`. Handler verifies signature, checks delivery idempotency, correlates event to a request, then patches **facts only** (no status write). Implementation: **app/api/github/webhook/route.ts**, **lib/requests/patchRequestFacts.ts**.

---

## Webhook types handled

| Event | Action |
|-------|--------|
| **pull_request** | Correlate by PR branch/title → requestId. Patch `github.pr` (open, merged, headSha, url, number). Append SSE event. |
| **pull_request_review** | Correlate by PR → requestId. Patch `approval` (approved, approvers) from review state. Append SSE event. |
| **workflow_run** | Classify kind (plan, apply, destroy, cleanup, drift_plan) via `classifyWorkflowRun`. Correlate (see below), then `patchWorkflowRun` for that kind. On destroy success, optionally trigger cleanup dispatch. Append SSE event when patch applied. |

---

## Correlation order (workflow_run)

1. **Run index (O(1))** — `getRequestIdByRunId(kind, runId)` from S3 `webhooks/github/run-index/<kind>/run-<runId>.json`. Used first for all kinds when `kind` and `workflow_run.id` are present.
2. **Destroy fallback** — If kind is `destroy` and index miss: `getRequestIdByDestroyRunId(runId)` (legacy list-based).
3. **Branch/title correlation** — `correlateWorkflowRun(payload)`: branch ref, workflow name/inputs, PR number, etc.

Result: requestId or null. If null, delivery is recorded and 200 returned; no patch.

---

## RunId guard (no cross-request pollution)

`patchWorkflowRun` in **lib/requests/patchRequestFacts.ts** only applies the incoming event when `workflow_run.id` matches the request’s **tracked** runId for that kind (from `github.workflows[kind].runId` or legacy `planRun`/`applyRun`/`destroyRun`). If the incoming runId differs from the tracked one, the patch returns a no-op (no update). So one request never receives another request’s run updates.

---

## Idempotency

- **Delivery idempotency:** `X-GitHub-Delivery` is checked via `hasDelivery(deliveryId)`. If already seen, respond `{ duplicate: true }` and do not process.
- **Patch idempotency:** If `patchWorkflowRun` produces an empty diff (status, conclusion, runId already match), it returns `{}`. Then `updateRequest(..., mutate)` receives `current => current` and performs **no S3 write**. No S3 write → no SSE append. So duplicate webhook deliveries do not cause redundant writes or SSE.

---

## Cleanup dispatch from webhook

When `workflow_run` is destroy and status is completed with conclusion success, the webhook may trigger cleanup dispatch (if not already dispatched for this destroy run). Uses `GITHUB_SERVER_TOKEN`. Sync with `?repair=1` can retry cleanup dispatch if it previously failed.
