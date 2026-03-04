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

- **Write:** `putRunIndex(kind, runId, requestId)` in `lib/requests/runIndex.ts`, called from plan/apply/destroy (and drift_plan when runId is available) dispatch routes (fire-and-forget). For **plan**, a run attempt is always created at dispatch (with headSha, ref, actor); runId/url may be missing until the GitHub runs list returns. When runId becomes available (create/update flow or sync repair), `patchAttemptRunId` attaches runId/url to the current attempt and `putRunIndex` is called. Cleanup is not indexed on dispatch (GitHub dispatch API does not return runId). Drift-plan is often dispatched externally; index is written only when TfPilot has runId.
- **See also:** **docs/GITHUB_WORKFLOWS.md**, **docs/WEBHOOKS_AND_CORRELATION.md**, **docs/SYSTEM_OVERVIEW.md** (Run execution model).
- **Read:** `getRequestIdByRunId(kind, runId)`; webhook tries this first for all kinds. If null, destroy falls back to list-based lookup; all kinds fall back to branch/title correlation.
- **After resolve:** Once requestId is known, the webhook patches only the **attempt record** in `request.runs[kind]` that matches the incoming `workflow_run.id` (via `patchRunsAttemptByRunId`). No other run state is written; there is no legacy run state or canonicalization.
- **Backwards compatibility:** `putDestroyRunIndex` / `getRequestIdByDestroyRunIdIndexed` remain as wrappers around the generic API.

## Environment destroy index (separate, facts-only)

For environment destroy (destroy_scope="environment"), correlation is stored under `webhooks/github/env-destroy/`:
- `run-<runId>.json` — runId → environment_id (webhook fast path)
- `pending-<environmentId>.json` — `{ run_id, repo, created_at }`; used for reconcile before dispatch. TTL 2h when run not found.

**Facts-only:** These indexes are correlation caches, never authoritative. Correlation is derivable (we pass `environment_id` in workflow inputs; webhook uses index first, then payload inputs on miss). See **lib/github/envDestroyRunIndex.ts** and **docs/OPERATIONS.md** (Environment destroy).

## Environment drift index (separate, facts-only)

For drift plan v2 (env-scoped drift detection), correlation is stored under `webhooks/github/env-drift/`:
- `run-<runId>.json` — `{ runId, environment_id, createdAt }` — runId → environment_id
- `by-env/<environmentId>.json` — `{ runs: [{ runId, createdAt }] }` — used for pruning

Used by `GET /api/environments/:id/drift-latest` to find the last drift run for an environment. Written when TfPilot dispatches drift_plan_v2 and resolves the runId. See **lib/github/envDriftRunIndex.ts**.

### Pruning policy (TTL 30 days)

- **Automatic:** On each `putEnvDriftRunIndex`, we prune entries for that environment older than 30 days. Pruning is **best-effort** and **fail-open** — it never blocks the main write. If pruning fails, the index write still succeeds.
- **Scope:** Per-environment. Entries for env E older than 30 days are deleted when a new drift run for E is indexed.
- **Retention:** 30 days. See `ENV_DRIFT_PRUNING_TTL_DAYS` in `lib/github/envDriftRunIndex.ts`.

### Manual cleanup (optional)

If the index grows unexpectedly (e.g. pruning was disabled or failed repeatedly), you can manually clean up:

1. **List objects** under `webhooks/github/env-drift/`:
   ```bash
   aws s3 ls s3://TFPILOT_REQUESTS_BUCKET/webhooks/github/env-drift/ --recursive
   ```

2. **Delete objects** older than 30 days. The `run-<runId>.json` files contain `createdAt` (ISO string). You can write a script to:
   - List all `run-*.json` under the prefix
   - For each, fetch and parse; if `createdAt` < now - 30 days, delete
   - Optionally delete `by-env/*.json` and let the next drift write recreate it (or delete only stale entries)

3. **Bulk expire** via S3 lifecycle (optional): Add a lifecycle rule on `webhooks/github/env-drift/` to expire objects after 35 days (slightly longer than app TTL for safety). This is additive to in-app pruning.
