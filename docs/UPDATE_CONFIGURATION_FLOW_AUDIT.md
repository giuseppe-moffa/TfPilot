# Update Configuration Flow — E2E Audit (Request Detail)

**Purpose:** Map the current "Update Configuration" flow end-to-end before refactoring to a form. No code changes in this audit.

---

## A) Entry points + UI components (file paths)

| What | Where |
|------|--------|
| **"Update Configuration" button** | `app/requests/[requestId]/page.tsx` ~1352–1359: `<Button … disabled={actionProgress?.state === "running"} onClick={() => setUpdateModalOpen(true)}">Update Configuration</Button>` |
| **Update Configuration modal** | Same file ~2118–2215: `<Dialog open={updateModalOpen}>` with `<DialogTitle>Update configuration</DialogTitle>`, `<DialogDescription>` "Submit a patch… We will open a new PR and supersede any open PR." |
| **Advanced raw JSON patch** | Same dialog ~2131–2152: `<details>` "Advanced (dangerous)" with `<Textarea value={patchText} … />`, "Reset" and "Submit update" buttons; `handlePatchSubmit` bound to submit. |
| **Assistant drawer** | Same dialog ~2153–2213: `<AssistantDrawer isOpen={assistantOpen} …>` with `SuggestionPanel` and `AssistantHelper`. Drawer is toggled by `assistantOpen` (no in-page button found to open it from this modal; may be opened elsewhere or start closed). |
| **SuggestionPanel** | `components/suggestion-panel.tsx`: shows suggestions/patch preview, "Apply" selection, calls `/api/requests/[requestId]/assistant/state` and `/api/requests/[requestId]/apply`. |
| **AssistantHelper** | `components/assistant-helper.tsx`: chat UI, calls `POST /api/infra-assistant`, passes `onAssistantState` to parent; parent in page is `onAssistantState={(state) => { setAssistantStateOverride(state); setPanelAssistantState(state); }}`. |
| **"Update branch" (separate flow)** | Same page: `handleUpdateBranch` ~743–765 calls `POST /api/github/update-branch` with `{ requestId }`. Button shown when `mergeNeedsUpdate` (merge error with "dirty" or "not mergeable") ~1579: Merge area "Update branch" opens merge modal / retry path. Not the same as "Update Configuration." |

**State variables (page):** `updateModalOpen`, `patchText` (default `"{\n}"`), `patchError`, `patchSubmitting`, `assistantOpen`, `assistantStateOverride`, `panelAssistantState`. **patchText is never pre-filled from `request.config`** when the modal opens.

---

## B) Sequence diagram (step list) of current flow

### Path 1 — Raw JSON patch ("Update Configuration" → Submit update)

1. User clicks **Update Configuration** → `setUpdateModalOpen(true)`.
2. Modal opens; user edits **Advanced** textarea (`patchText`) or leaves default `{\n}`.
3. User clicks **Submit update** → `handlePatchSubmit()`.
4. Client parses `patchText` as JSON object; on failure sets `patchError` and returns.
5. `setPatchSubmitting(true)`; `POST /api/requests/update` with `body: JSON.stringify({ requestId, patch: parsed })`.
6. On success: `setUpdateModalOpen(false)`; if `data.request` then `mutate(data.request, false)` else `revalidate()`. (Update route does **not** return `request`, so client always does **revalidate**.)
7. On error: `setPatchError(message)`; finally `setPatchSubmitting(false)`.

### Path 2 — Assistant (chat → suggestions → apply to config)

1. User opens Update Configuration modal; optionally opens assistant drawer (if/when `assistantOpen` is true).
2. **Chat:** User types in AssistantHelper → `POST /api/infra-assistant` with `messages`, `project`, `environment`, `module`, `fieldsMeta`, `currentInputs`. AI returns JSON with `patch`, `rationale`, `clarifications`; normalized by `normalizeAssistantResponse`; parent gets state via `onAssistantState(state)` → `setAssistantStateOverride` + `setPanelAssistantState`.
3. **Persist suggestions (optional):** SuggestionPanel can `POST /api/requests/[requestId]/assistant/state` with `suggestions` (and optional `clarifications`, `hash`) to store assistant state on the request.
4. **Apply selected suggestions:** User selects suggestions and clicks Apply → `applySelected()` in SuggestionPanel. For **existing** request (not `requestId === "new-request"`):  
   - If only synthetic suggestion (patch preview): first `POST /api/requests/[requestId]/assistant/state` with that suggestion, then `onRefresh()`.  
   - Then `POST /api/requests/[requestId]/apply` with `{ suggestionIds: ids }`.  
   - Apply route **only updates S3** (config + assistant_state); it does **not** create branch/PR or trigger plan.
5. After apply: `setStatus("Applied to configuration.")`; `onRefresh()` (which is `revalidate()` on detail page). So UI refreshes from sync; **repo/PR/plan are unchanged** until user does a separate "Update Configuration" submit (e.g. raw patch) that triggers `/api/requests/update`.

### Path 3 — Update branch (merge recovery)

1. Shown when merge fails with "dirty" or "not mergeable" (`mergeNeedsUpdate`). User clicks "Update branch" (in merge context) → `handleUpdateBranch()`.
2. `POST /api/github/update-branch` with `{ requestId }`. Server runs `runUpdateBranch` (merge base into PR branch, resolve conflicts if 409).
3. On success: `mutate(data.request, false)` if `data?.request` else `revalidate()`. (Update-branch route does **not** return `request`, so client **revalidates**.)
4. `setMergeStatus("idle")`, `setMergeModalOpen(false)`.

---

## C) Backend endpoints involved (payload / response)

| Route | Method | Request body | Response (success) | Notes |
|-------|--------|--------------|--------------------|--------|
| **/api/requests/update** | POST | `{ requestId: string, patch: Record<string, unknown> }` | `{ success: true, requestId, revision, prUrl, planRunId }` — **no `request`** | Session + role (not viewer); GitHub token; idempotency `x-idempotency-key` (optional); lock; blocks if apply running. |
| **/api/infra-assistant** | POST | `{ messages, project?, environment?, module?, fieldsMeta?, currentInputs? }` | AI response normalized to assistant state (patch, clarifications, etc.) | Session required; used by AssistantHelper chat. |
| **/api/requests/[requestId]/assistant/state** | POST | `{ suggestions?, clarifications?, hash? }` | `{ success: true, request: updated }` or 400 (e.g. hash mismatch) | Persists assistant_state on request; optional hash for consistency. |
| **/api/requests/[requestId]/apply** | POST | `{ suggestionIds: string[] }` | `{ success: true, request: updated }` | Applies selected suggestions to **config in S3 only**; no branch/PR/plan. 409 if locked. |
| **/api/github/update-branch** | POST | `{ requestId: string }` | `{ ok: true, alreadyUpToDate?, sha?, resolvedConflicts? }` — **no `request`** | Back-merge base into PR branch; used when PR not mergeable. |

---

## D) What gets persisted (S3 request patch fields)

**POST /api/requests/update** (after full success):

- **config** — merged and validated: `buildModuleConfig(regEntry, mergedInputs, ctx)` then `appendRequestIdToNames`, `injectServerAuthoritativeTags`, `assertRequiredTagsPresent`, `validatePolicy`.
- **revision** — incremented (`revisionNext`).
- **updatedAt** — now.
- **branchName**, **prNumber**, **prUrl**, **commitSha**, **activePrNumber**, **previousPrs** — from `createBranchCommitPrAndPlan`.
- **pr** — `{ number, url, merged: false, headSha, open: true }`.
- **targetOwner**, **targetRepo**, **targetBase**, **targetEnvPath**, **targetFiles**.
- **planRun** — `{ runId, url, headSha }` from workflow dispatch.
- **moduleRef** / **registryRef** — repo/commit refs.
- **rendererVersion** — `"tfpilot-renderer@1"`.
- **render** — `{ renderHash, inputsHash, reproducible, computedAt }` (deterministic hashes).
- **idempotency** — if idempotency key was sent and recorded.
- **lock** — released after save (via `releaseLock`).

**POST /api/requests/[requestId]/apply** (suggestion apply):

- **config** — built from current config + selected suggestion patch ops, validated with module registry and policy.
- **assistant_state** — `applied_suggestion_ids`, `applied_patch_log` updated.
- **updatedAt** — now.  
No branch, PR, or plan fields changed; **Terraform repo is not updated**.

---

## E) What triggers Terraform repo changes / PR updates

- **Only POST /api/requests/update** drives repo/PR/plan:
  1. Fetches current target file from GitHub (`getEnvTargetFile`, `fetchRepoFile`).
  2. Ensures existing tfpilot block for this request exists in that file.
  3. Builds `finalConfig` (merge patch + current config, validate via `moduleRegistry`), then `renderModuleBlock({ ...current, config: finalConfig }, moduleSource)` → HCL module block.
  4. `upsertRequestBlock(existingFile, requestId, block)` — replaces content between `# --- tfpilot:begin:${requestId} ---` and `# --- tfpilot:end:${requestId} ---`.
  5. `createBranchCommitPrAndPlan(...)`:
     - Creates branch `update/${requestId}/rev-${revisionNext}` (or reuses), force-push commit with updated file.
     - Creates PR (or supersedes: closes previous PR, comments, new PR).
     - Dispatches plan workflow: `POST .../actions/workflows/${PLAN_WORKFLOW}/dispatches` with `ref: branchName`, `inputs: { request_id, environment }`.
  6. Optionally closes superseded PR via `closeSupersededPr`.
- **POST /api/github/update-branch** only updates the **existing** PR branch (back-merge base, conflict resolve); it does not change config or create a new revision/PR.

---

## F) Current caching behavior (req:${id} patch/revalidate)

- **Canonical key:** `req:${requestId}` from `hooks/use-request.ts` (`requestCacheKey(id)`). Data comes from **GET /api/requests/[requestId]/sync** (syncFetcher).
- **After POST /api/requests/update:** Response has no `request`. Client does `if (data?.request) mutate(data.request, false) else revalidate()`. So **revalidate()** is always used → full refetch from sync.
- **After POST /api/requests/[requestId]/apply:** Response has `request: updated`. Client only calls `onRefresh()` which is `revalidate()` (SuggestionPanel does not call `mutate(updatedRequest)`). So **revalidate()** again.
- **After POST /api/github/update-branch:** No `request` in response; client revalidates.
- **Table seeding:** If list/detail share the same key (e.g. list seeds `req:${id}`), revalidate will refill from sync; no explicit table seeding in this flow.

---

## G) Constraints (when blocked, why)

- **Update Configuration button:** Disabled when `actionProgress?.state === "running"` (any of approve/merge/apply/destroy in progress). `handlePatchSubmit` does **not** set `actionProgress`, so only other actions block the button.
- **POST /api/requests/update:**  
  - 409 if **lock** held by another operation (`LockConflictError`).  
  - 409 if **apply is running** (`isApplyRunning(current)`).  
  - 400 if existing request block **not found** in target file (e.g. wrong branch or file changed).  
  - 400 if **module unknown**, **validation fails** (policy, required fields, enum, region allowlist).  
  - Idempotency: optional `x-idempotency-key`; replay returns 200 with stored revision/prUrl/planRunId (no full request).
- **POST /api/requests/[requestId]/apply:**  
  - 409 if **locked** (plan/apply running per `isLocked()`).  
  - 400 if no matching suggestions or invalid patch path / unset required field.
- **Stale UI / button state:** If update returns success but client only revalidates, UI can lag until sync completes. Apply/destroy handlers patch cache with returned `request`; update and update-branch do not return `request`, so revalidate is the only refresh and can be slower or show stale data briefly.

---

## H) Files to modify to replace AI flow with a form (no code yet)

1. **app/requests/[requestId]/page.tsx**  
   - Replace or complement "Update Configuration" modal: form for editable fields (from module schema) instead of/in addition to raw JSON + assistant.  
   - Pre-fill form from `request.config` when modal opens.  
   - On submit: either build patch from diff (current vs form values) and call existing `POST /api/requests/update`, or add a new endpoint that accepts full config; ensure one source of truth (form → update API).  
   - Keep or remove AssistantDrawer/SuggestionPanel/AssistantHelper depending on product choice.  
   - Optionally have update API return `request` and patch cache for instant UI.

2. **app/api/requests/update/route.ts**  
   - Optionally accept a **full config** body (e.g. `config?: Record<string, unknown>`) in addition to `patch`; if `config` provided, use it (after validation) instead of merge.  
   - Return **request** in success response so client can `mutate(data.request, false)` and avoid revalidate lag.

3. **components/suggestion-panel.tsx**  
   - If form is primary: either remove "Apply" path that calls `/api/requests/[requestId]/apply`, or make "Apply" write into the new form state and then user submits form (so one path to repo update).  
   - If assistant is removed from this modal: consider deleting or relocating SuggestionPanel/AssistantHelper usage.

4. **components/assistant-helper.tsx**  
   - If form replaces AI: no changes if assistant is kept as optional; if assistant is removed from Update Configuration, stop rendering it in this modal.

5. **app/api/requests/[requestId]/apply/route.ts**  
   - If suggestion "Apply" only updates S3 and user must still do "Submit update" to push to repo: either document this clearly or add a flow that after apply optionally calls update (e.g. internal or client-triggered) so one click applies and pushes.

6. **app/api/requests/[requestId]/assistant/state/route.ts**  
   - No change required for form-only; keep if assistant state is still used elsewhere (e.g. new request page).

7. **config/module-registry.ts**  
   - Source of truth for fields and validation; form generator should use same `moduleRegistry` (or GET /api/modules/schema) for field list, types, required, immutable, enum.

8. **hooks/use-request.ts**  
   - No change; keep `mutate`/`revalidate`. If update returns `request`, detail page uses `mutate(data.request, false)` in handlePatchSubmit.

9. **lib/github/updateBranch.ts**, **app/api/github/update-branch/route.ts**  
   - No change for "Update Configuration" form; they belong to the "Update branch" (merge recovery) flow.

10. **docs/UI_STATE_LIFECYCLE_UX_AUDIT.md**, **docs/ACTION_CONSISTENCY_AUDIT.md**  
    - Update to describe form-based update and any new cache behavior (e.g. patch with returned request).

---

## Summary

- **Update Configuration** on Request Detail has two entry paths: **(1)** raw JSON patch in the modal → **POST /api/requests/update** (full flow: S3 + branch + PR + plan); **(2)** assistant chat → suggestions → **POST /api/requests/[requestId]/apply** (S3 only; no PR/plan). To get assistant-applied config to the repo, user must perform a separate update (e.g. submit patch) that calls **POST /api/requests/update**.
- **Update branch** is a separate action (merge recovery); it does not change config.
- Config validation and Terraform rendering use **moduleRegistry** and **request.config**; deterministic hashes are **inputsHash** and **renderHash** on the request doc. Render is server-side in the update route via `renderModuleBlock` and `upsertRequestBlock`; plan is triggered by workflow dispatch after the commit.
- Caching: canonical key **req:${id}**; after update and update-branch the client **revalidates** (no patch) because those endpoints do not return `request`. Apply/destroy patch the cache with the returned request.
