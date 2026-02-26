# Run index (S3)

O(1) lookup from GitHub workflow run ID to TfPilot request ID for workflow_run webhooks (plan, apply, destroy, cleanup, drift_plan).

## Where it lives

Same bucket as request documents: **TFPILOT_REQUESTS_BUCKET** (e.g. `tfpilot-requests`). Objects live under the prefix below; no separate bucket or infra.

## Key format (all kinds)

- **Prefix:** `webhooks/github/run-index/<kind>/`
- **Key:** `webhooks/github/run-index/<kind>/run-<runId>.json`
- **Kinds:** `plan`, `apply`, `destroy`, `cleanup`, `drift_plan`

Examples:

- `webhooks/github/run-index/plan/run-123456789.json`
- `webhooks/github/run-index/apply/run-123456790.json`
- `webhooks/github/run-index/destroy/run-123456791.json`
- `webhooks/github/run-index/cleanup/run-123456792.json`
- `webhooks/github/run-index/drift_plan/run-123456793.json`

## Value shape

```json
{
  "kind": "apply",
  "runId": 123456790,
  "requestId": "req_dev_ec2_abc",
  "createdAt": "2025-01-15T10:00:00.000Z",
  "expiresAt": "2025-04-15T10:00:00.000Z"
}
```

- **kind:** One of `plan`, `apply`, `destroy`, `cleanup`, `drift_plan`.
- **createdAt:** When the index entry was written (dispatch time).
- **expiresAt:** Intended retention boundary (createdAt + 90 days). **Metadata only** — S3 does not auto-delete from this field until you add a lifecycle rule on the prefix (see below).

## Intended retention

- **90 days.** After that, entries are only needed for rare late webhooks. Fallback correlation (branch/title) or, for destroy, list-based lookup still works for requests that never had an index (e.g. pre-index deploys).

## Future S3 lifecycle rule (non-blocking)

Until you add a lifecycle rule, **expiresAt is metadata only**; objects are not deleted automatically. To make the bucket self-cleaning:

- Add a bucket lifecycle rule that expires objects under prefix `webhooks/github/run-index/` (or each sub-prefix `plan/`, `apply/`, `destroy/`, `cleanup/`, `drift_plan/`) after 90 days (or 95 to be safe).
- This is optional; app behavior is unchanged if the rule is not added.

## Destroy and workflow_dispatch

GitHub’s `workflow_dispatch` API does **not** return the new run’s `runId`; the caller only gets a 204. So for destroy (and any workflow we trigger by dispatch), we must **correlate after the fact**: list workflow runs for the repo/workflow, filter by the ref we dispatched and by `created_at >= dispatchTime`, then pick the earliest matching run. Because runs can appear with a short delay and back-to-back destroys in the same env would otherwise both claim “the latest run”, we **enforce uniqueness via the run index**: before assigning a runId to a request we check `getRequestIdByRunId("destroy", runId)`. If that runId is already mapped to another request we skip it and try the next candidate, so no two requests ever get the same destroy runId.

## Implementation

- **Write:** `putRunIndex(kind, runId, requestId)` in `lib/requests/runIndex.ts`, called from plan/apply/destroy (and drift_plan when runId is available) dispatch via `lib/requests/persistWorkflowDispatch.ts` (fire-and-forget). Cleanup is not indexed on dispatch (GitHub dispatch API does not return runId). Drift-plan is often dispatched externally; index is written only when TfPilot has runId.
- **See also:** **docs/GITHUB_WORKFLOWS.md**, **docs/WEBHOOKS_AND_CORRELATION.md**.
- **Read:** `getRequestIdByRunId(kind, runId)`; webhook tries this first for all kinds. If null, destroy falls back to list-based lookup; all kinds fall back to branch/title correlation.
- **Patch guard:** `patchWorkflowRun` only updates a request when the incoming `workflow_run.id` matches the request’s tracked runId for that kind (prevents cross-request updates).
- **Backwards compatibility:** `putDestroyRunIndex` / `getRequestIdByDestroyRunIdIndexed` remain as wrappers around the generic API.
