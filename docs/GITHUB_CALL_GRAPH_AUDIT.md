# GitHub API Call Graph — Audit & Call-Reduction Hardening Plan

**Scope:** Every GitHub API call in TfPilot: who calls what, why, how often, cache, and rate-limit risk.  
**No refactors in this doc; read-only.**

---

## A) GitHub Client Entry Points

| Entry point | File | Used for | Bypasses cache? |
|-------------|------|----------|-----------------|
| **gh** | `lib/github/client.ts` | Raw fetch to `https://api.github.com${path}`. Throws on !res.ok. | Yes — no TTL, no cache. |
| **githubRequest** | `lib/github/rateAware.ts` | GET (and HEAD) with in-memory TTL cache, rate-limit backoff, retries. | No — all cached by `key` + `ttlMs`. |
| **ghResponse** | `lib/github/client.ts` | Used only by rateAware (returns Response for header reading). | N/A |

**Single wrapper for cached GETs:** `githubRequest()` in `lib/github/rateAware.ts`.  
**Bypasses:** Any call that uses `gh()` directly is uncached and counts against rate limit every time.

**Files that call GitHub:**

- `app/api/requests/[requestId]/sync/route.ts` — githubRequest (many), no direct gh.
- `app/api/requests/[requestId]/destroy/route.ts` — gh (dispatches), githubRequest (workflow runs).
- `app/api/requests/route.ts` — gh (create: refs, blobs, trees, commits, pulls, contents, dispatch), githubRequest (workflow runs).
- `app/api/requests/update/route.ts` — gh (contents, refs, blobs, trees, commits, ref PATCH, pulls, issues comments, PATCH pull), githubRequest (workflow runs, PR state).
- `app/api/github/pr-diff/route.ts` — **gh only** (pulls/:pr/files).
- `app/api/github/plan-output/route.ts` — **gh only** (run, jobs, logs).
- `app/api/github/apply-output/route.ts` — **gh only** (run, jobs, logs).
- `app/api/github/approval-status/route.ts` — **gh only** (pulls/:pr/reviews).
- `app/api/github/plan/route.ts` — gh (dispatch), githubRequest (PR, workflow runs).
- `app/api/github/apply/route.ts` — gh (dispatch), githubRequest (workflow runs).
- `app/api/github/merge/route.ts` — gh (merge PUT), githubRequest (PR when branch unknown).
- `lib/github/updateBranch.ts` — **gh only** (compare, contents?ref=, commits, blobs, trees, refs PATCH, pulls, repo default branch, merge). Used by merge route when merge fails (update-branch then retry).

---

## B) Call Inventory Table

| Call name | GitHub path / action | Where called | Trigger type | Purpose | Frequency | Cache key | TTL / dedup | Failure (rate limit) |
|-----------|----------------------|--------------|--------------|---------|-----------|-----------|-------------|------------------------|
| Get PR | GET `/repos/:owner/:repo/pulls/:number` | sync/route.ts ~240 | sync | pr (state, merged, headSha, merge_commit_sha) | per request sync | gh:pr:owner:repo:number | 30s | Backoff then throw after retries |
| Get PR reviews | GET `.../pulls/:number/reviews` | sync/route.ts ~270 | sync | request.approval | per request sync | gh:pr-reviews:owner:repo:number | 15s | same |
| Get cleanup PR | GET `.../pulls?head=owner:cleanup/:id&state=all&per_page=1` | sync/route.ts ~304 | sync | request.cleanupPr | per request sync | gh:cleanup-pr:owner:repo:requestId | 15s | same |
| List plan workflow runs | GET `.../actions/workflows/:plan.yml/runs?branch=...&per_page=3` | sync/route.ts ~340 | sync | planRun discovery when !planRun.runId | per request sync (conditional) | gh:wf-runs:owner:repo:plan.yml:branch | 15s | same |
| List apply workflow runs | GET `.../actions/workflows/:apply.yml/runs?branch=...&per_page=5` | sync/route.ts ~378 | sync | applyRun discovery when !existingApplyRun.runId | per request sync (conditional) | gh:wf-runs:owner:repo:apply.yml:branch | 15s | same |
| Get run (apply existing) | GET `.../actions/runs/:runId` | sync/route.ts ~416 | sync | applyRun hydration | per request sync when applyRun.runId | gh:run:owner:repo:runId | 10s | same |
| Get run (apply discovered) | GET `.../actions/runs/:runId` | sync/route.ts ~446 | sync | applyRun hydration | per request sync (conditional) | gh:run:owner:repo:runId | 10s | same |
| Get run (plan) | GET `.../actions/runs/:runId` | sync/route.ts ~491 | sync | planRun status/conclusion, then logs | per request sync when planRun.runId | gh:run:owner:repo:runId | 10s | same |
| Get run (destroy) | GET `.../actions/runs/:runId` | sync/route.ts ~522 | sync | destroyRun status/conclusion | per request sync when destroyRun.runId | gh:run:owner:repo:runId | 10s | same |
| List run jobs | GET `.../actions/runs/:runId/jobs` | sync/route.ts fetchJobLogs ~176 | sync | jobId for logs | per request sync when planRun.runId | gh:jobs:owner:repo:runId | 10s | same |
| Get job logs | GET `.../actions/jobs/:jobId/logs` | sync/route.ts fetchJobLogs ~185 | sync | plan output extraction | per request sync when planRun.runId | gh:logs:owner:repo:jobId | **0** | same |
| **PR files (diff)** | GET `.../pulls/:number/files` | **app/api/github/pr-diff/route.ts ~32** | **UI route** | Files changed list + patch for "Files Changed" | **Per detail page when prNumber set; SWR dedupe 5s** | **None (gh only)** | **No cache** | **Throw → 500 (403)** |
| Get run | GET `.../actions/runs/:runId` | plan-output/route.ts ~56 | UI route | status/conclusion | When planKey active (planRunId && !plan?.output) | None | No cache | Throw → 500 |
| List run jobs | GET `.../actions/runs/:runId/jobs` | plan-output/route.ts fetchJobLogs ~25 | UI route | jobId for logs | same | None | No cache | Throw → 500 |
| Get job logs | GET `.../actions/jobs/:jobId/logs` | plan-output/route.ts ~30 | UI route | plan text | same | None | No cache | Throw → 500 |
| Get run | GET `.../actions/runs/:runId` | apply-output/route.ts ~40 | UI route | status/conclusion | When applyKey active (showApplyOutput && applyRunId) | None | No cache | Throw → 500 |
| List run jobs + logs | GET jobs, GET logs | apply-output/route.ts fetchJobLogs | UI route | apply log text | same | None | No cache | Throw → 500 |
| Get PR reviews | GET `.../pulls/:number/reviews` | approval-status/route.ts ~28 | UI route | approved, approvers | On demand (who calls?) | None | No cache | Throw → 500 |
| Merge PR | PUT `.../pulls/:num/merge` | merge/route.ts ~86 | action | Merge | Per user click Merge | N/A (mutate) | — | Throw |
| Get PR (branch) | GET `.../pulls/:num` | merge/route.ts ~133 | action | branchName when merge fails + update-branch | Conditional | gh:pr:owner:repo:num | 30s | same |
| Plan dispatch | POST `.../actions/workflows/:plan.yml/dispatches` | plan/route.ts ~101, requests/route.ts ~531, update/route.ts ~376 | action / create / update | Trigger plan workflow | Per user click / create / update | N/A | — | Throw |
| Get PR (plan) | GET `.../pulls/:number` | plan/route.ts ~117 | action | planHeadSha | After dispatch | gh:pr:... | 30s | same |
| List plan runs | GET `.../workflows/:plan.yml/runs?branch=...` | plan/route.ts ~130, requests/route.ts ~546, update/route.ts ~391 | action / create / update | planRunId | After dispatch | gh:wf-runs:... | 15s | same |
| Apply dispatch | POST `.../workflows/:apply.yml/dispatches` | apply/route.ts ~122 | action | Trigger apply | Per user click Apply | N/A | — | Throw |
| List apply runs | GET `.../workflows/:apply.yml/runs?branch=...` | apply/route.ts ~130 | action | applyRunId | After dispatch | gh:wf-runs:... | 15s | same |
| Cleanup dispatch | POST `.../workflows/cleanup.yml/dispatches` | destroy/route.ts ~162 | action | Trigger cleanup | Per user click Destroy | N/A | — | .catch log only |
| Destroy dispatch | POST `.../workflows/destroy.yml/dispatches` | destroy/route.ts ~174 | action | Trigger destroy | Per user click Destroy | N/A | — | Throw |
| List destroy runs | GET `.../workflows/destroy.yml/runs?branch=...` | destroy/route.ts ~191 | action | destroyRunId | After dispatch | gh:wf-runs:... | 15s | same |
| Get file (repo contents) | GET `.../contents/:path` | update/route.ts fetchRepoFile ~227, route.ts fetchRepoFile ~224 | action / create | Existing TF file body | Update config / create | None | No cache | Throw |
| Create branch + commit + PR + plan dispatch | refs, commits, blobs, trees, refs PATCH, pulls POST, dispatch | requests/route.ts createBranchCommitPrAndPlan | create | New request PR + plan | Per new request | None | No cache | Throw |
| Update branch (merge conflict path) | compare, contents?ref=, commits, blobs, trees, refs PATCH, pulls, repo, merge | lib/github/updateBranch.ts, merge/route.ts | action | Resolve conflicts, push, retry merge | When merge fails (not mergeable / out of date) | None | No cache | Throw |
| Close superseded PR | PATCH `.../pulls/:previousPrNumber`, POST issues/:num/comments | update/route.ts ~438, ~445 | action | Close old PR, comment | On update when previousPrNumber set | None | No cache | Throw |
| Get PR (close superseded) | GET `.../pulls/:number` | update/route.ts ~428 | action | merged state before close | Same | gh:pr:owner:repo:number | 30s | same |

**Summary:** Sync uses only `githubRequest` (cached). UI routes **pr-diff**, **plan-output**, **apply-output**, **approval-status** use **gh() only** → no cache, every request hits GitHub. **update/route** and **requests/route** use many **gh()** calls for git/PR operations (no cache). **updateBranch** is all **gh()** (no cache).

---

## C) “Hot Path” Analysis (Rate Limit Suspects)

1. **GET `/repos/:owner/:repo/pulls/:number/files` (pr-diff)**  
   - **Where:** `app/api/github/pr-diff/route.ts` via `gh()` (no cache).  
   - **Trigger:** Detail page SWR key `prFilesKey = prNumber ? [pr-files, requestId, prNumber] : null` with `dedupingInterval: 5000`. So every 5s per open detail page that has a PR, and on mount.  
   - **Multiplied by:** Detail page polling (useRequest refreshInterval e.g. 10s idle) + every user with detail open. So **N users × M detail pages × (1 every 5s + on mount)**.  
   - **Direct cause of 403 in screenshot:** This endpoint is unauthenticated-app rate limited and not cached; heavy use from “Files Changed” section.

2. **Sync route — full bundle per request**  
   - One sync call runs: PR + reviews + cleanup PR + (optionally) plan runs list + apply runs list + up to 2× get run (apply) + get run (plan) + jobs + **logs** (TTL 0) + get run (destroy).  
   - **Multiplied by:** Detail page mount + idle refreshInterval (e.g. 10s) + revalidateOnFocus. So each open detail tab triggers sync at interval; multiple tabs/users multiply.

3. **Job logs (sync)**  
   - `gh:logs:owner:repo:jobId` has **ttlMs: 0** → never cached. So every sync that has planRun.runId does jobs + logs (2 calls, logs always fresh). High volume when many requests have plan runs.

4. **plan-output / apply-output (UI)**  
   - Each uses **gh()** 3 times (run + jobs + logs) per request. Triggered by SWR when planKey/applyKey active; dedupe 5s. Multiplied by users and tabs.

5. **Workflow run listing**  
   - Sync can do: plan runs list (if !planRun.runId) + apply runs list (if !existingApplyRun.runId, per branch). So 1–2 list calls per sync; cached 15s. Less critical than uncached GETs but still per-sync.

**Calls in terminal states:**  
- Sync does **not** skip PR, reviews, cleanup PR, plan run, apply run, or destroy run fetches when status is merged/applied/destroyed. So we keep refetching PR and runs even when lifecycle is terminal.  
- **pr-diff** is requested whenever `prNumber` is set; no gate for “PR merged” or “destroyed.”

---

## D) Gating Logic (When Calls Should NOT Happen)

| Call type | Current gating | Missing gating |
|-----------|----------------|----------------|
| PR (sync) | Only when `request.pr?.number` | Skip when PR merged and mergedSha stable (e.g. status merged/applied/destroyed). |
| PR reviews (sync) | Same as PR | Same; reviews immutable after merge. |
| Cleanup PR (sync) | When targetOwner/targetRepo | Skip when request destroyed and cleanupPr.merged. |
| Plan run list (sync) | When !planRun?.runId | OK. |
| Apply run list (sync) | When !existingApplyRun?.runId | OK. |
| Get run (plan/apply/destroy) (sync) | When runId present | Skip when run terminal (status completed + conclusion) and we already have it. |
| **fetchJobLogs (sync)** | When planRun.runId | **Skip when request.plan?.output already present** (plan output already extracted). |
| **pr-diff (UI)** | When prNumber | **Skip when PR merged or request applied/destroyed**; or make on-demand (e.g. expand section only). |
| plan-output (UI) | When planRunId && !request?.plan?.output | Good; could also skip when status terminal and plan in request. |
| apply-output (UI) | When showApplyOutput && applyRunId | Good (user-driven). |
| approval-status (UI) | None | Skip when PR merged. |

---

## E) Recommendations List (NO IMPLEMENTATION YET)

**Ranked by impact vs effort:**

1. **PR files (pr-diff): make on-demand or gate**  
   - **Option A:** Do not fetch in SWR by default; fetch only when user expands “Files Changed” or clicks “Load diff”.  
   - **Option B:** Gate SWR key: e.g. `prFilesKey = prNumber && !isMerged && !isDestroyed ? [...] : null` so we don’t call when PR is merged or request destroyed.  
   - **Option C:** Route pr-diff through a small server cache (e.g. same key/ttl as rateAware) so repeated hits don’t hit GitHub.  
   - **Impact:** Removes or greatly reduces the call that is currently returning 403 in production.

2. **Cache pr-diff and/or use githubRequest in pr-diff route**  
   - Use `githubRequest` in `app/api/github/pr-diff/route.ts` with key e.g. `gh:pr-files:owner:repo:prNumber` and TTL 30–60s.  
   - **Impact:** One call per (owner, repo, prNumber) per TTL instead of per client request.

3. **Gate sync PR/reviews/cleanup/run fetches by lifecycle**  
   - When `deriveLifecycleStatus(request)` is merged/applied/destroyed and we already have mergedSha / run conclusion, skip: PR, reviews, cleanup PR, and (optionally) get run for plan/apply/destroy.  
   - **Impact:** Large reduction in sync GitHub calls for terminal requests (most of the table).

4. **Skip fetchJobLogs in sync when plan.output already present**  
   - In sync, if `request.plan?.output` is already set, do not call fetchJobLogs for plan run.  
   - **Impact:** Saves 2 calls (jobs + logs) per sync for requests that already have plan output; logs TTL 0 is currently the worst offender in sync.

5. **Increase TTLs for stable data**  
   - PR metadata (merged, state): 30s → 60s or 120s for merged PRs.  
   - Run status: 10s → 30s when run is completed.  
   - **Impact:** Fewer cache misses under polling.

6. **Share in-flight requests per cache key**  
   - In rateAware (or a thin wrapper), coalesce concurrent GETs for the same key into one in-flight promise.  
   - **Impact:** Multiple tabs/users opening same request don’t multiply identical calls during the same second.

7. **Degrade on 403 instead of throw for pr-diff / plan-output / apply-output**  
   - On 403 (rate limit or forbidden), return 200 with cached/stale payload if available (e.g. last successful response stored in memory or from request doc), or 200 with `{ files: [], rateLimited: true }` so UI can show “Unavailable” instead of 500.  
   - **Impact:** Better UX and fewer retry storms.

8. **Move plan-output and apply-output to sync-populated fields**  
   - Sync already fetches plan logs and can set `request.plan.output`. Detail page could use that and only call plan-output when plan output is missing and plan run is active. apply-output could be populated from sync if we add apply log extraction, or stay on-demand with a cached backend.  
   - **Impact:** Removes or reduces uncached jobs+logs calls from UI routes.

9. **Consolidate sync calls**  
   - e.g. Single “batch” endpoint that returns PR + reviews + cleanup PR + runs in one server-side flow with one token and shared cache.  
   - **Impact:** Fewer round-trips and easier to apply gating in one place.

10. **Idempotent cleanup dispatch retry**  
    - If cleanup workflow dispatch fails (currently only logged), persist “cleanup requested” and retry on next sync or cron.  
    - **Impact:** Reliability, not rate limit.

---

## Done-When Checklist

- **Exactly which GitHub calls cause rate limits:** PR files (pr-diff), sync job logs (TTL 0), and uncached UI routes (plan-output, apply-output, approval-status). Sync’s volume scales with open detail tabs × refresh interval.  
- **Which are safe to gate by lifecycle:** PR, PR reviews, cleanup PR, get run (plan/apply/destroy), fetchJobLogs in sync; pr-diff and approval-status on UI.  
- **Which can be cached longer or moved to on-demand:** PR and run status (longer TTL when terminal); pr-diff (on-demand or cached); plan/apply output (sync-populated or cached backend).

*End of audit. No code changes; use this as the spec for a call-reduction hardening plan.*
