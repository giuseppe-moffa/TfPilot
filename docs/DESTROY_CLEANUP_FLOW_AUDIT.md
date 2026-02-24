# Destroy Cleanup Flow — E2E Audit Report

**Scope:** How destroy cleanup removes TfPilot blocks from Terraform env files and why it might fail.  
**No refactors in this doc; code-read only.**

---

## A) Flow Diagram: Destroy Success → Cleanup Branch/PR → TF File Change → Merge

```
[User clicks Destroy (admin)]
         │
         ▼
POST /api/requests/:id/destroy
         │
         ├─► Acquire lock, idempotency check, prod allowlist
         │
         ├─► DISPATCH cleanup workflow (fire-and-forget)
         │      • Ref: targetBase (e.g. main)
         │      • Inputs: request_id, environment, target_base, cleanup_paths, target_env_path, auto_merge
         │      • cleanup_paths = request.targetFiles.join(",") OR getEnvTargetFile(targetEnvPath, getModuleType(module))
         │      • On dispatch failure: console.error only; no retry, request still updated
         │
         ├─► DISPATCH destroy workflow (await not required)
         │
         ├─► Discover destroy run (runs list), update request with destroyRun, cleanupPr: { status: "pending" }
         │
         └─► Persist: destroyRun, cleanupPr (pending), archive copy
         │
         ▼
[Cleanup workflow runs in infra repo — e.g. core-terraform/.github/workflows/cleanup.yml]
         │
         ├─► Checkout ref (target_base)
         ├─► Normalize cleanup_paths → paths.txt (one path per line)
         ├─► If paths.txt empty → "No cleanup paths provided; skipping removal" → exit 0
         ├─► For each path in paths.txt:
         │      • If path not .tf → skip
         │      • Find "# --- tfpilot:begin:{request_id} ---" and "# --- tfpilot:end:{request_id} ---"
         │      • If both found: remove [start … newline after end], write file (or "\n" if empty)
         │      • If markers not found: "Markers not found in {p}, leaving file untouched"
         ├─► Branch: cleanup/{request_id} (create or checkout existing origin/cleanup/{request_id})
         ├─► git add -A; if no changes → no_changes=true → skip commit/push/PR
         ├─► git commit -m "Cleanup request {request_id}"; push
         ├─► gh pr create (base=target_base, head=cleanup/{request_id})
         └─► If auto_merge=true (non-prod): gh pr merge --merge --auto
         │
         ▼
[Sync: GET /api/requests/:id/sync]
         │
         ├─► Fetch PRs: head=owner:cleanup/{request.id}, state=all, per_page=1
         ├─► If PR found → request.cleanupPr = { number, url, status (open/closed), merged, headBranch }
         ├─► Timeline: append "Cleanup PR opened" / "Cleanup PR merged" if new
         └─► Persist cleanupPr, timeline to S3 request doc
```

**Important:** Cleanup is triggered when the user clicks Destroy, **not** when the destroy workflow completes. Cleanup and destroy run in parallel. There is no webhook or automatic trigger on "destroyed" status.

---

## B) Exact File Paths and Functions

| Responsibility | Location | Notes |
|----------------|----------|--------|
| **Trigger** | `app/api/requests/[requestId]/destroy/route.ts` | POST handler; lines 143–171: dispatch cleanup workflow then destroy workflow. Cleanup dispatch is fire-and-forget (`.catch` only logs). |
| **Cleanup paths** | Same file, 146–163 | `cleanupPaths` = `request.targetFiles` joined, or `getEnvTargetFile(request.targetEnvPath, getModuleType(request.module))` if targetFiles empty. |
| **Request doc patch (destroy)** | Same file, 228–234 | `updateRequest`: sets `destroyRun`, `cleanupPr: current.cleanupPr ?? { status: "pending" }`. |
| **File edit / block removal** | **Infra repo** `core-terraform` or `payments-terraform`: `.github/workflows/cleanup.yml` | Step "Remove tfpilot blocks": inline Python (lines 74–106). Reads `paths.txt`, for each path finds `# --- tfpilot:begin:{req_id} ---` / `# --- tfpilot:end:{req_id} ---`, removes from start through newline after end. |
| **Branch / commit / PR** | Same workflow | Step "Create branch and commit": branch `cleanup/${{ inputs.request_id }}`; step "Create PR": `gh pr create`; step "Enable auto-merge": `gh pr merge … --auto` when `auto_merge == 'true'`. |
| **Merge** | Manual or auto | Auto-merge only when `inputs.auto_merge == 'true'` (non-prod). Prod: manual merge. |
| **Request doc patch (cleanupPr)** | `app/api/requests/[requestId]/sync/route.ts` | Lines 300–333: discover PR by `pulls?head=owner:cleanup/{request.id}`; 624–657: set `request.cleanupPr`, timeline, then `updateRequest(..., cleanupPr: request.cleanupPr, ...)`. |

**Where markers are written (for reference):**

- `app/api/requests/route.ts`: `upsertRequestBlock` — `# --- tfpilot:begin:${requestId} ---` / `# --- tfpilot:end:${requestId} ---` (create request).
- `app/api/requests/update/route.ts`: same markers for updates; `getEnvTargetFile(targetEnvPath, moduleType)` → single target file path.

**Module → file mapping:** `lib/infra/moduleType.ts`: `getEnvTargetFile(envPath, type)` → `${envPath}/tfpilot.${type}.tf` (e.g. `envs/dev/tfpilot.s3.tf`).

---

## C) Current Invariants / Gating Logic

**To run cleanup (dispatch):**

1. **POST /api/requests/:id/destroy** is called (admin only).
2. `env.GITHUB_CLEANUP_WORKFLOW_FILE` is set (e.g. `cleanup.yml`).
3. `request.targetOwner` and `request.targetRepo` are set.
4. Lock acquired; idempotency and prod-destroy allowlist pass.

**Not gated on:**

- Destroy run conclusion (success/failure).
- Request derived status "destroyed".
- Cleanup PR already existing or merged.
- Whether the TF file still contains the block.

**Cleanup workflow (inside repo):**

- **Block removal:** Runs only if `paths.txt` is non-empty (i.e. `cleanup_paths` input non-empty).
- **Commit/PR:** Only if `git status` has changes after removal (otherwise `no_changes=true`, no commit, no PR).
- **Concurrency:** `concurrency.group: core-terraform-${{ inputs.environment }}-${{ inputs.request_id }}` (one cleanup per request per env).

**Sync (discovery of cleanup PR):**

- Requires `request.targetOwner` and `request.targetRepo`.
- PR lookup: `head=owner:cleanup/{request.id}`, `state=all`. First match is used.
- No explicit link from request doc to PR except branch name convention and sync’s GET.

---

## D) Likely Root Causes for "Destroyed Block Not Removed" (Ranked)

1. **Empty `cleanup_paths`**  
   - **Cause:** `request.targetFiles` empty and fallback fails (e.g. missing `targetEnvPath` or `request.module`).  
   - **Effect:** Workflow runs but "No cleanup paths provided; skipping removal" → no file edits → no changes → no commit/PR.  
   - **Locations:** Destroy route 148–163; workflow 70–72.

2. **Markers not found in file**  
   - **Cause:** File was rewritten without markers; different requestId format; wrong file path (e.g. wrong module type or env path).  
   - **Effect:** Python prints "Markers not found in {p}, leaving file untouched" → no diff → no commit/PR.  
   - **Location:** Workflow lines 89–90, 102–103.  
   - **Assumption:** Block was originally created by TfPilot with exact `# --- tfpilot:begin:{requestId} ---` / `# --- tfpilot:end:{requestId} ---` (no extra spaces/typos).

3. **Wrong file path**  
   - **Cause:** `targetFiles` from create used a different path than current repo layout; or single-file fallback wrong (e.g. multi-module request stored as one path).  
   - **Effect:** Workflow edits a different file or path not found ("Path not found, skipping").  
   - **Location:** Destroy 146–163; workflow 84–86.

4. **Cleanup workflow dispatch failure**  
   - **Cause:** GitHub API error, permissions, or wrong workflow file name.  
   - **Effect:** `.catch` in destroy route only logs; cleanup never runs; `cleanupPr` stays `{ status: "pending" }`.  
   - **Location:** Destroy 162–170.

5. **PR created but empty diff**  
   - **Cause:** Block already removed (e.g. manual edit or previous cleanup); or markers removed by hand so removal step no-ops.  
   - **Effect:** `git status` empty in workflow → no_changes → no commit/push; but if workflow had already committed in a previous run, PR could exist with an empty or stale diff.  
   - **Location:** Workflow 121–126.

6. **Cleanup PR never discovered in sync**  
   - **Cause:** Sync uses `head=owner:cleanup/{request.id}`; if branch name or owner differs, or API fails, cleanupPr stays pending.  
   - **Effect:** UI shows "Pending" forever even though PR exists.  
   - **Location:** Sync 303–316, 331 (catch ignores).

7. **Multiple blocks / first-occurrence only**  
   - **Cause:** Python uses `text.find(marker_start)` and `text.find(marker_end)` (first occurrence). If one file had two blocks for same requestId (abnormal), only first is removed.  
   - **Likelihood:** Low (one block per request per file in normal flow).

---

## E) Minimal Hardening Plan (No Code Yet)

1. **Stronger block identifiers**  
   - Consider a single unique sentinel (e.g. block UUID or checksum) in the marker line so that drift or duplicate requestIds don’t remove the wrong range.  
   - Keep backward compatibility: still support current marker format and migrate gradually.

2. **Safer HCL parse vs regex**  
   - Current logic is string search (exact markers + slice). Option: parse HCL, identify module blocks that contain the requestId in a comment, remove only that block.  
   - Reduces risk of removing too much/little if markers are duplicated or malformed.

3. **Idempotent cleanup retries**  
   - If cleanup workflow dispatch fails, persist "cleanup requested" (e.g. flag or timestamp).  
   - Sync or a cron could retry dispatch when request is destroyed and cleanupPr still pending.  
   - Avoid double-commit: workflow already reuses branch `cleanup/{request_id}` and only commits when there are changes.

4. **Conflict handling strategy**  
   - Workflow checks out `target_base`; if base moved, removal is applied on top.  
   - Document: on conflict, prefer "abort and retry" or "re-run workflow on latest base" so cleanup branch is rebased/regenerated once.

5. **"No-op but expected changes" detection + alert**  
   - When cleanup runs with non-empty `cleanup_paths` but "Markers not found" for a path: treat as anomaly.  
   - Emit structured log or metric (requestId, path, marker search result).  
   - Optional: step that fails the job if any path in paths.txt resulted in "Markers not found" (strict mode).

6. **Observability**  
   - **Destroy route:** Log cleanup_paths and request_id when dispatching; log on dispatch failure (already console.error).  
   - **Sync:** Log when cleanupPr is discovered (number, merged).  
   - **Workflow:** Already prints "Removed tfpilot block...", "Markers not found...", "Path not found...". Add a step output (e.g. `removed_count`, `paths_without_markers`) for dashboards/alerts.

---

## Checklist Summary

| # | Item | Answer |
|---|------|--------|
| 1 | **Trigger** | User clicks Destroy → POST destroy → cleanup workflow dispatch (no webhook, not on destroy success). |
| 1 | **Gating** | Not gated on destroyRun conclusion or "destroyed" status. Gated on: admin, lock, targetOwner/targetRepo, GITHUB_CLEANUP_WORKFLOW_FILE. |
| 1 | **cleanupPr stored** | In S3 request doc: `cleanupPr: { number?, url?, status?, merged?, headBranch? }`. Set to `{ status: "pending" }` on destroy; updated by sync when PR is found. |
| 2 | **Endpoints** | POST `/api/requests/:id/destroy` (orchestration + dispatch). GET `/api/requests/:id/sync` (discovers PR, patches cleanupPr). No dedicated cleanup API. |
| 2 | **Idempotency** | Destroy uses getIdempotencyKey(req); assertIdempotentOrRecord(operation: "destroy"). |
| 2 | **Lock** | acquireLock(operation: "destroy") before dispatch; releaseLock after updateRequest. |
| 3 | **Files modified** | From `request.targetFiles` or `getEnvTargetFile(targetEnvPath, getModuleType(module))` (e.g. `envs/dev/tfpilot.s3.tf`). |
| 3 | **Block identification** | Comment markers: `# --- tfpilot:begin:{request_id} ---` and `# --- tfpilot:end:{request_id} ---`. Python `str.find`; remove from start through newline after end. |
| 3 | **Determinism** | No HCL parse; exact string match. Newline after end marker handled explicitly. |
| 4 | **Repo/PR** | New branch `cleanup/{request_id}`; PR from that branch to target_base; auto-merge only when auto_merge=true (non-prod). |
| 4 | **Conflicts** | Not handled; workflow checks out base and applies removal. Re-run would re-apply on current base. |
| 5 | **No-op cases** | Empty cleanup_paths; markers not found; path not found; non-.tf path; git status clean after removal. |
| 6 | **Logging** | Destroy: logError/logInfo/logWarn for idempotency/lock; console.error for cleanup dispatch failure. Workflow: Python print. Sync: cleanup PR discovery in try/catch (ignored on error). |

---

*End of audit. No code changes; for implementation use this as the spec.*
