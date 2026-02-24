(event-driven GitHub → TfPilot truth, with repair-only sync)
Phase 0 — Prep and invariants

Invariant: request status remains derived only.

Invariant: webhook patches facts only (PR, reviews, runs, cleanup PR), never writes status.

Add: eventLog on request doc (bounded, last N=50) to support idempotency/debug:

{id, type, receivedAt, key, applied: boolean}

Add: request.updatedAt bump on any fact patch.

Phase 1 — Webhook receiver (no behavior changes yet)

Create endpoint: POST /api/github/webhook

Verify signature (X-Hub-Signature-256) using shared secret.

Parse headers:

X-GitHub-Event, X-GitHub-Delivery

Implement idempotency:

key = delivery_id

store “seen deliveries” in S3 (global) OR per-request eventLog once correlated

Return 200 quickly (don’t call GitHub inside webhook unless absolutely necessary).

Phase 2 — Correlation (map event → requestId)

Implement correlation function:

Inputs: repo owner/name, event payload, optional PR number, branch, head SHA

Correlation order:

branch ref contains requestId (request/req_*)

PR title/body contains requestId (pattern req_[a-z0-9_]+)

workflow_run name contains requestId OR workflow inputs contain request_id

fallback: map PR number → request by scanning S3 index (you likely already store prNumber on request doc)

Output: {requestId | null, confidence, hints}

Phase 3 — Apply webhook patches (facts only)

Implement handlers per event type:

pull_request

Patch:

pr / pullRequest fields (open/closed/merged, headSha, url, number)

activePrNumber if needed

pull_request_review

Patch:

approval.approved, approval.approvers

Only if review state is APPROVED; handle dismissal if you support it.

workflow_run

Patch:

Determine workflow kind (plan/apply/destroy/cleanup) via workflow_path (or workflow name/id).

Patch the appropriate {planRun, applyRun, destroyRun, cleanupRun}:

runId, status, conclusion, headSha, url, completedAt

Do not clear existing active runs if you can’t correlate.

If event indicates completed+success for destroy:

trigger cleanup dispatch only after destroy success (if cleanup not done).

Phase 4 — Cleanup hardening (event-triggered)

Replace “dispatch cleanup at destroy click time” with:

Dispatch cleanup on workflow_run destroy completed success OR sync repair detects it.

Store:

cleanupPr: {status, prNumber, url, createdAt, mergedAt, lastError}

Webhook for cleanup PR events updates cleanupPr.

Phase 5 — Make /sync repair-only (reduce GitHub calls)

Default /api/requests/:id/sync:

returns stored request + derived status

no GitHub calls unless ?repair=1 OR missing critical facts.

Add degraded mode on rate-limit:

return stored request + sync.degraded=true + retryAfterMs

Gate GitHub calls heavily:

never fetch PR files/diff in sync

only fetch PR metadata if PR is open and stale

only fetch workflow run details if runId known and status not terminal

Phase 6 — UI “instant” updates without GitHub calls

Keep SWR canonical cache req:${id}.

Add SSE (optional) endpoint: /api/stream

emits {requestId, updatedAt} on webhook patches

UI listens and revalidates req:${id} and list

Cheapest alternative: light polling against TfPilot only (no GitHub) 5–15s.

Phase 7 — Observability + ops

Metrics:

webhook events received/applied/dropped

correlation failures

repair sync count

GitHub calls per route

Structured logs with delivery_id, requestId, eventType, workflow_kind.

Phase 8 — Rollout plan (safe)

Deploy webhook receiver + logging only

Enable PR merged + workflow_run completed patching

Enable cleanup dispatch post-destroy success

Reduce sync GitHub calls (repair-only)

Optional SSE