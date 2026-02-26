# TfPilot context pack (new chat paste)

Tight reference for continuing work: lifecycle, webhooks, SSE, status derivation, workflows. Valid docs: **docs/DOCS_INDEX.md**, **docs/SYSTEM_OVERVIEW.md**, **docs/REQUEST_LIFECYCLE.md**, **docs/GITHUB_WORKFLOWS.md**, **docs/WEBHOOKS_AND_CORRELATION.md**, **docs/OPERATIONS.md**, **docs/RUN_INDEX.md**, **docs/GLOSSARY.md**.

---

## Agent instructions (follow when using this pack)

- **Be concise.** Prefer short answers: bullets, one-line explanations, file paths. Avoid long prose unless the user asks for detail.
- **When the user needs code changes, multi-step tasks, or repo-wide work:** Suggest using the **Cursor agent** (e.g. “Use Cursor’s agent with the TfPilot rules” or “Run this as a Cursor agent task”) and point to **.cursor/rules/agent-routing.mdc** and **docs/prompts/MASTER.md** so the agent gets role + guardrails. If the user explicitly requests a Cursor agent prompt or task, provide a short prompt they can paste (what to do, which repo/area, any constraints).

---

## 1) What TfPilot is

TfPilot is an AI-assisted Terraform self-service platform. Users create requests (project + environment + module + config); the app persists to S3, generates **deterministic** Terraform via templates/modules, opens PRs, and **GitHub Actions** run plan/apply/destroy/cleanup. Lifecycle is **PR-based**: create → plan → approve → merge → apply; optional destroy (cleanup PR strips TfPilot block, then destroy). **S3** holds request JSON (and chat logs). Status is **derived from facts only** (no optimistic status writes). **Webhooks** (`pull_request`, `pull_request_review`, `workflow_run`) patch request facts; an **SSE stream** (`/api/stream`) pushes events so the UI can revalidate without polling.

---

## 2) End-to-end flow

1. **Create** — POST `/api/requests`: persist to S3, branch `request/<requestId>`, open PR, dispatch plan. Run index written (runId → requestId).
2. **Plan** — Workflow runs `terraform plan -lock=false`; webhook/sync patch `planRun` (or `github.workflows.plan`). Status derived → `planning` then `plan_ready`.
3. **Approve** — User approves; POST approve writes `approval.approved` + approvers (facts only).
4. **Merge** — PR merged; merge route sets `mergedSha`; webhook can patch `pr.merged`. Derived → `merged`.
5. **Apply** — User triggers apply; dispatch apply workflow; run index written; webhook/sync patch `applyRun`. Derived → `applying` → `applied`.
6. **Destroy** — User triggers destroy; cleanup workflow dispatched (fire-and-forget), destroy workflow dispatched; `destroyRun` + `destroyTriggeredAt` set. Cleanup PR strips TfPilot block; after destroy success, request archived to `history/`. Webhook on destroy success may trigger cleanup dispatch.
7. **Facts stored:** `pr` / `github.pr`, `planRun` / `github.workflows.plan`, `applyRun` / `github.workflows.apply`, `destroyRun` / `github.workflows.destroy`, `approval`, `mergedSha`, `timeline`. **Status is never authoritative**; it is always derived by `deriveLifecycleStatus(request)`.

---

## 3) Data model: Request JSON (example)

```json
{
  "id": "req_dev_s3_tgqpp8",
  "project": "core",
  "environment": "dev",
  "module": "s3-bucket",
  "config": {
    "name": "core-dev-ai-agent-tgqpp8",
    "project": "core",
    "environment": "dev",
    "request_id": "req_dev_s3_tgqpp8",
    "versioning_enabled": false,
    "force_destroy": true,
    "block_public_access": true,
    "enable_lifecycle": false,
    "noncurrent_expiration_days": 30,
    "abort_multipart_days": 7,
    "encryption_mode": "sse-s3",
    "tags": {
      "ManagedBy": "tfpilot",
      "TfPilotRequestId": "req_dev_s3_tgqpp8",
      "Project": "core",
      "Environment": "dev",
      "tfpilot:request_id": "req_dev_s3_tgqpp8",
      "tfpilot:project": "core",
      "tfpilot:environment": "dev",
      "tfpilot:created_by": "giuseppe-moffa",
      "tfpilot:template_id": "s3-public-assets"
    }
  },
  "receivedAt": "2026-02-26T18:45:08.637Z",
  "updatedAt": "2026-02-26T18:52:48.077Z",
  "revision": 1,
  "status": "created",
  "plan": {
    "diff": "+ aws_s3_bucket.main"
  },
  "templateId": "s3-public-assets",
  "environmentName": "ai-agent",
  "moduleRef": {
    "repo": "giuseppe-moffa/core-terraform",
    "path": "modules/s3-bucket",
    "commitSha": "eb3817118ccf241bee548823745dcee4e26b6b2b",
    "resolvedAt": "2026-02-26T18:45:14.651Z"
  },
  "registryRef": {
    "commitSha": "unknown",
    "resolvedAt": "2026-02-26T18:45:14.651Z"
  },
  "rendererVersion": "tfpilot-renderer@1",
  "render": {
    "renderHash": "sha256:1618353e7baafe4983714b7fbe0724d32da620a6548af16725b1968285f82f4a",
    "inputsHash": "sha256:e7b93e4a94f5859e8b08d6717cdca18a6d9b9c203b5cf7cb9272cc106a16548a",
    "reproducible": true,
    "computedAt": "2026-02-26T18:45:14.651Z"
  },
  "branchName": "request/req_dev_s3_tgqpp8",
  "prNumber": 223,
  "prUrl": "https://github.com/giuseppe-moffa/core-terraform/pull/223",
  "commitSha": "c02cef273d1a05b15dc52c354a3e1db53de23dc3",
  "activePrNumber": 223,
  "pr": {
    "number": 223,
    "url": "https://github.com/giuseppe-moffa/core-terraform/pull/223",
    "status": "open",
    "merged": false,
    "headSha": "c02cef273d1a05b15dc52c354a3e1db53de23dc3",
    "open": true
  },
  "targetOwner": "giuseppe-moffa",
  "targetRepo": "core-terraform",
  "targetBase": "main",
  "targetEnvPath": "envs/dev",
  "targetFiles": [
    "envs/dev/tfpilot.s3.tf"
  ],
  "planRun": {
    "runId": 22456244688,
    "status": "completed",
    "conclusion": "success",
    "headSha": "c02cef273d1a05b15dc52c354a3e1db53de23dc3",
    "url": "https://github.com/giuseppe-moffa/core-terraform/actions/runs/22456244688"
  },
  "assistant_state": {
    "last_suggestions_hash": null,
    "suggestions": [],
    "clarifications": [],
    "clarifications_resolved": {},
    "applied_suggestion_ids": [],
    "applied_patch_log": []
  },
  "version": 9,
  "pullRequest": {
    "number": 223,
    "url": "https://github.com/giuseppe-moffa/core-terraform/pull/223",
    "title": "Infra request req_dev_s3_tgqpp8: s3-bucket",
    "merged": false,
    "headSha": "c02cef273d1a05b15dc52c354a3e1db53de23dc3",
    "open": true,
    "status": "open"
  },
  "approval": {
    "approved": false,
    "approvers": []
  },
  "timeline": []
}
```

**Authoritative fields:**

- **Workflow runs (facts are canonical):** Canonical workflow facts live under `github.workflows[kind]` (plan, apply, destroy, cleanup). Top-level `planRun`, `applyRun`, `destroyRun` are **legacy compatibility** fields and may be removed in a future version. Derivation prefers `request.github?.workflows?.[kind] ?? request.planRun` etc.
- **TriggeredAt:** `github.destroyTriggeredAt` (and similar for other kinds in dispatch code) — used for stale destroy (15 min timeout).
- **PR + merge:** `pr` or `github.pr` (number, url, merged, headSha, open). `mergedSha` set by merge route when GitHub merge succeeds.
- **Status:** Not authoritative. UI/API use `deriveLifecycleStatus(request)`. Stored `status` is legacy/informational; `statusDerivedAt` may exist but derivation ignores it.
- **Timeline:** Array of steps (e.g. "Cleanup PR opened"); sync appends when cleanup PR discovered.

---

## 4) Critical code paths (snippets)

### Status derivation — `lib/requests/deriveLifecycleStatus.ts`

- **Purpose:** Single entrypoint; status = pure function of request facts.
- **Key:** `deriveLifecycleStatus(request)`; reads `github?.pr ?? pr`, `github?.workflows?.plan ?? planRun`, same for apply/destroy, `approval`, `mergedSha`.
- **Priority (abridged):** destroy failed → failed; destroy success → destroyed; destroy in progress (and not stale) → destroying; destroy stale (>15 min no conclusion) → failed; apply failed → failed; plan failed → failed; apply running → applying; apply success → applied; pr.merged or mergedSha → merged; approval → approved; plan success → plan_ready; plan running / pr.open → planning; else request_created.
- **Exports:** `DESTROY_STALE_MINUTES = 15`, `isDestroyRunFailed(request)`, `isDestroyRunStale(request)`.
- **Used:** Sync response, list derivation, UI `deriveLifecycleStatus(request)`, metrics.

```ts
// Priority tail (excerpt)
if (pr?.merged) return "merged"
if (request.mergedSha) return "merged"
if (approval?.approved) return "approved"
if (planRun?.conclusion === "success") return "plan_ready"
if (planRun?.status === "in_progress" || planRun?.status === "queued") return "planning"
if (pr?.open) return "planning"
return "request_created"
```

### Workflow run patching + runId guard + idempotency — `lib/requests/patchRequestFacts.ts`

- **Purpose:** Patch request from webhook payloads; facts only (github, approval, updatedAt). Never remove existing workflow facts.
- **runId guard:** `patchWorkflowRun` only applies when `workflow_run.id === trackedRunId` (tracked = `github.workflows[kind].runId` or legacy `planRun`/`applyRun`/`destroyRun.runId`). If runId differs, returns no-op patch so no cross-request pollution.
- **Idempotency:** If `existing.status === runFact.status && existing.conclusion === runFact.conclusion && existing.runId === runFact.runId`, returns `{}`. Caller does `next === current` → no S3 write → no SSE.
- **Monotonic:** Never overwrite concluded run with null conclusion; never overwrite completed with in_progress/queued; never overwrite with older `updated_at` when existing is active.

```ts
// runId guard (excerpt)
const trackedRunId = cur.github?.workflows?.[kind]?.runId ?? (kind === "plan" ? cur.planRun?.runId : ...)
if (run?.id != null && trackedRunId != null && trackedRunId !== run.id) {
  return { github: { ...current.github, workflows: { ...current.github?.workflows } }, updatedAt }
}
// Idempotency
if (existing?.status === runFact.status && existing?.conclusion === runFact.conclusion && existing?.runId === runFact.runId) {
  return {}
}
```

### Workflow classification — `lib/github/workflowClassification.ts`

- **Purpose:** Classify `workflow_run` webhook by name/display_title → kind.
- **Order (critical):** Check drift_plan first (`"drift"` and `"plan"`), then apply, destroy, cleanup, plan last. So "Drift Plan" never becomes "plan".
- **Types:** `WorkflowKind = "plan" | "apply" | "destroy" | "cleanup" | "drift_plan"`.

```ts
const lower = combined.toLowerCase()
if (lower.includes("drift") && lower.includes("plan")) return "drift_plan"
if (lower.includes("apply")) return "apply"
if (lower.includes("destroy")) return "destroy"
if (lower.includes("cleanup")) return "cleanup"
if (lower.includes("plan")) return "plan"
return null
```

### Run index — `lib/requests/runIndex.ts`

- **Purpose:** O(1) S3 lookup runId → requestId for webhook correlation.
- **Key:** `webhooks/github/run-index/<kind>/run-<runId>.json`. Value: `{ kind, runId, requestId, createdAt, expiresAt }`. `expiresAt` = createdAt + 90 days (metadata only unless S3 lifecycle rule).
- **Functions:** `putRunIndex(kind, runId, requestId)`, `getRequestIdByRunId(kind, runId)`.
- **Used:** Webhook workflow_run (index first); dispatch routes via `persistWorkflowDispatch.ts`.

### Webhook handler — `app/api/github/webhook/route.ts`

- **Flow:** Verify signature → delivery idempotency (`hasDelivery`) → parse event. For `workflow_run`: classify kind → resolve requestId (see order below) → if no requestId, record delivery, return 200. Then `updateRequest(..., current => patchWorkflowRun(...)); if (saved) appendStreamEvent(...).`
- **Resolution order for workflow_run:**
  1. `getRequestIdByRunId(kind, runId)` — S3 run index, O(1).
  2. Destroy-only fallback: `getRequestIdByDestroyRunId(runId)` — legacy list-based lookup.
  3. `correlateWorkflowRun(payload)` — branch/title fallback.
- **DEBUG_WEBHOOKS:** Set `process.env.DEBUG_WEBHOOKS === "1"` to log index hits: `event=webhook.resolve scope=index kind= runId= requestId=`, and unknown workflow_run: `event=webhook.workflow_run.unknown runId= name= displayTitle=`.

```ts
if (kind != null && wr?.id != null) {
  const requestIdIndexed = await getRequestIdByRunId(kind, wr.id)
  if (requestIdIndexed != null && process.env.DEBUG_WEBHOOKS === "1") {
    console.log("event=webhook.resolve scope=index kind=%s runId=%s requestId=%s", kind, String(wr.id), requestIdIndexed)
  }
  ...
}
const [, saved] = await updateRequest(correlated.requestId, (current) => {
  const patch = patchWorkflowRun(current, kind, payload)
  return Object.keys(patch).length === 0 ? current : { ...current, ...patch }
})
if (saved) await appendStreamEvent(...)
```

### Requests store — `lib/storage/requestsStore.ts`

- **Purpose:** S3 CRUD for request JSON; optimistic locking via `version`.
- **Critical:** `updateRequest(requestId, mutate)` returns `[request, saved]`. If `mutate(current) === current` (same reference), **no write**, `saved === false`. So idempotent patch (empty object from `patchWorkflowRun`) → no S3 write → no SSE.
- **Paths:** `requests/<requestId>.json`, `history/<requestId>.json` (archive).

```ts
const next = mutate(current)
if (next === current) return [current, false]
// ... version increment, saveRequest
return [payload, true]
```

### SSE stream

- **lib/github/streamState.ts:** S3 key `webhooks/github/stream.json`. `appendStreamEvent({ requestId, updatedAt, type })` read-modify-write; seq monotonic; trim to last 50 events. **Only called when a request write actually occurred** (e.g. after webhook patch that changed doc).
- **app/api/stream/route.ts:** GET, session required. Polls `getStreamState()` every 2s; sends SSE `event: request`, `data: JSON.stringify(ev)` for events with `ev.seq > since`. Heartbeat every 15s. Client passes `?since=<seq>`.
- **lib/sse/streamClient.ts:** Client-only. Single `EventSource` to `/api/stream?since=${lastSeq}`. `subscribeToRequestEvents(handler)` → on "request" event, update lastSeq, call handlers. Handlers typically call `globalMutate("req:" + requestId)` and `globalMutate("/api/requests")`.
- **Hooks:** `useRequest(requestId)` (hooks/use-request.ts): SWR key `req:${id}`, fetcher = GET `/api/requests/${id}/sync`. Subscribes to SSE; on event calls `globalMutate(k)` and `globalMutate("/api/requests")`. Polling: when SSE connected, refreshInterval at least 60s; when apply/destroy active, 0 (page drives sync). `useRequestStatus` (hooks/use-request-status.ts): similar; used for detail page with nonce and 429 backoff.

---

## 5) Workflow files (full YAML)

**Repos:** **core-terraform** and **payments-terraform** share the same layout; repo name in concurrency group and backend config differs (e.g. `core-terraform-state-${{ inputs.environment }}` vs `payments-terraform-state-...`).

**Summary:** Env-scoped (state group): apply, destroy. Request-scoped: plan, cleanup. **-lock=false:** plan, drift-plan (no DynamoDB lock). Artifact paths: `envs/${{ env.ENVIRONMENT }}/...`.

---

### apply.yml

```yaml
name: Terraform Apply

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: "Request ID (optional)"
        required: false
        type: string
      environment:
        description: "Environment (dev or prod)"
        required: true
        type: choice
        options:
          - dev
          - prod

concurrency:
  group: core-terraform-state-${{ inputs.environment }}
  cancel-in-progress: false

permissions:
  id-token: write
  contents: read

jobs:
  apply:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment == 'prod' && 'production' || 'nonprod' }}
    env:
      ENVIRONMENT: ${{ inputs.environment || 'dev' }}
    defaults:
      run:
        working-directory: envs/${{ env.ENVIRONMENT }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::420259807324:role/tfplan-connector
          aws-region: eu-west-2
          role-session-name: tfplan-apply

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Debug AWS identity and context
        run: |
          set -euxo pipefail
          aws sts get-caller-identity
          aws configure get region || true
          echo "TF_WORKING_DIR=$(pwd)"
          terraform version
          pwd
          ls -la

      - name: Terraform Init
        run: |
          set -euxo pipefail
          terraform init -input=false \
            -backend-config="bucket=tfpilot-tfstate-core-${{ env.ENVIRONMENT }}" \
            -backend-config="key=terraform.tfstate" \
            -backend-config="region=eu-west-2" \
            -backend-config="dynamodb_table=tfpilot-tfstate-lock-core-${{ env.ENVIRONMENT }}" \
            -backend-config="encrypt=true"

      - name: Terraform Apply
        run: |
          set -euxo pipefail
          # Scope apply to this request's module (same as plan and destroy)
          REQUEST_ID="${{ inputs.request_id }}"
          TARGET_ARG=""
          if [ -n "$REQUEST_ID" ]; then
            MODULE_NAME="tfpilot_$(echo "$REQUEST_ID" | sed 's/[^a-zA-Z0-9_]/_/g')"
            TARGET_ARG="-target=module.${MODULE_NAME}"
          fi
          terraform apply -input=false -auto-approve -lock-timeout=300s $TARGET_ARG | tee apply.txt

      - name: Upload apply logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: apply-logs
          path: |
            envs/${{ env.ENVIRONMENT }}/apply.txt
            envs/${{ env.ENVIRONMENT }}/.terraform.lock.hcl
```

---

### cleanup.yml

```yaml
name: Terraform Cleanup

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: "TfPilot request ID"
        required: true
      environment:
        description: "Target environment"
        required: true
      target_base:
        description: "Base branch"
        required: false
        default: "main"
      cleanup_paths:
        description: "Comma-separated paths to remove"
        required: false
        default: ""
      target_env_path:
        description: "Environment path (informational)"
        required: false
        default: ""
      auto_merge:
        description: "Auto-merge when not prod"
        required: false
        default: "false"
      ref:
        description: "Git ref (commit/branch) to checkout (defaults to target_base)"
        required: false
        default: ""
      dry_run:
        description: "If true, skip pushing/PR creation (plan only)"
        required: false
        default: "false"

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: core-terraform-${{ inputs.environment }}-${{ inputs.request_id }}
  cancel-in-progress: false

jobs:
  cleanup:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment == 'prod' && 'production' || 'nonprod' }}
    env:
      DRY_RUN: ${{ inputs.dry_run || 'false' }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref || inputs.target_base }}

      - name: Configure git
        run: |
          git config user.name "tfpilot-bot"
          git config user.email "tfpilot-bot@users.noreply.github.com"

      - name: Normalize cleanup paths
        id: paths
        run: |
          echo "${{ inputs.cleanup_paths }}" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d' > paths.txt
          count=$(wc -l < paths.txt || true)
          echo "count=$count" >> $GITHUB_OUTPUT

      - name: Remove tfpilot blocks
        run: |
          if [ ! -s paths.txt ]; then
            echo "No cleanup paths provided; skipping removal"
            exit 0
          fi
          python <<'PY'
          import pathlib, os

          req_id = os.environ.get("REQ", "")
          marker_start = f"# --- tfpilot:begin:{req_id} ---"
          marker_end = f"# --- tfpilot:end:{req_id} ---"

          paths = [p.strip() for p in pathlib.Path("paths.txt").read_text().splitlines() if p.strip()]

          for p in paths:
              path = pathlib.Path(p)
              if not path.exists():
                  print(f"Path not found, skipping: {p}")
                  continue
              if path.suffix == ".tf":
                  text = path.read_text()
                  start = text.find(marker_start)
                  end = text.find(marker_end)
                  if start != -1 and end != -1:
                      end_line = text.find("\n", end)
                      if end_line == -1:
                          end_line = len(text)
                      new_text = text[:start] + text[end_line + 1 :]
                      if new_text.strip():
                          path.write_text(new_text)
                          print(f"Removed tfpilot block for {req_id} from {p}")
                      else:
                          path.write_text("\n")
                          print(f"Block removed; {p} left as empty file")
                  else:
                      print(f"Markers not found in {p}, leaving file untouched")
              else:
                  print(f"Skipping non-TF path {p}; no removal performed")
          PY
        env:
          REQ: ${{ inputs.request_id }}

      - name: Create branch and commit
        id: commit
        run: |
          BR="cleanup/${{ inputs.request_id }}"
          git fetch origin "$BR" || true
          if git ls-remote --exit-code origin "$BR" >/dev/null 2>&1; then
            git checkout -B "$BR" "origin/$BR"
          else
            git checkout -B "$BR" "${{ inputs.target_base }}"
          fi
          git status --short
          if git status --short | grep . >/dev/null 2>&1; then
            git add -A
          else
            echo "no_changes=true" >> $GITHUB_OUTPUT
            exit 0
          fi
          git commit -m "Cleanup request ${{ inputs.request_id }}"
          if [ "${DRY_RUN}" = "true" ]; then
            echo "Dry run: skipping push/PR"
            exit 0
          fi
          git push origin "$BR"
          echo "branch=$BR" >> $GITHUB_OUTPUT

      - name: Create PR
        id: pr
        if: steps.commit.outputs.no_changes != 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BR="${{ steps.commit.outputs.branch }}"
          pr_info=$(gh pr create \
            --base "${{ inputs.target_base }}" \
            --head "$BR" \
            --title "Cleanup request ${{ inputs.request_id }}" \
            --body "Automated cleanup for request ${{ inputs.request_id }} in environment '${{ inputs.environment }}'.")
          pr_url=$(gh pr view "$BR" --json url --jq .url)
          pr_number=$(gh pr view "$BR" --json number --jq .number)
          echo "url=$pr_url" >> $GITHUB_OUTPUT
          echo "number=$pr_number" >> $GITHUB_OUTPUT
          echo "$pr_info"

      - name: Enable auto-merge (non-prod)
        if: inputs.auto_merge == 'true' && steps.pr.outputs.number != ''
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr merge "${{ steps.pr.outputs.number }}" --merge --auto
```

---

### destroy.yml

```yaml
name: Terraform Destroy

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: "Request ID"
        required: true
        type: string
      environment:
        description: "Environment (dev or prod)"
        required: true
        type: choice
        options:
          - dev
          - prod
      ref:
        description: "Git ref (commit/branch) to checkout (defaults to base)"
        required: false
        default: ""
      dry_run:
        description: "If true, skip terraform destroy (for testing)"
        required: false
        default: "false"

concurrency:
  group: core-terraform-state-${{ inputs.environment }}
  cancel-in-progress: false

permissions:
  id-token: write
  contents: read

jobs:
  destroy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment == 'prod' && 'production' || 'nonprod' }}
    env:
      ENVIRONMENT: ${{ inputs.environment }}
      DRY_RUN: ${{ inputs.dry_run || 'false' }}
    defaults:
      run:
        working-directory: envs/${{ env.ENVIRONMENT }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref || 'main' }}

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::420259807324:role/tfplan-connector
          aws-region: eu-west-2
          role-session-name: tfplan-destroy

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Debug context
        run: |
          set -euxo pipefail
          aws sts get-caller-identity
          terraform version
          pwd
          ls -la

      - name: Terraform Init
        run: |
          set -euxo pipefail
          terraform init -input=false \
            -backend-config="bucket=tfpilot-tfstate-core-${{ env.ENVIRONMENT }}" \
            -backend-config="key=terraform.tfstate" \
            -backend-config="region=eu-west-2" \
            -backend-config="dynamodb_table=tfpilot-tfstate-lock-core-${{ env.ENVIRONMENT }}" \
            -backend-config="encrypt=true"

      - name: Terraform Destroy (target module)
        run: |
          set -euxo pipefail
          if [ "${DRY_RUN}" = "true" ]; then
            echo "Dry run enabled; skipping destroy"
            exit 0
          fi
          REQUEST_ID="${{ inputs.request_id }}"
          MODULE_NAME="tfpilot_$(echo "$REQUEST_ID" | sed 's/[^a-zA-Z0-9_]/_/g')"
          terraform destroy -input=false -auto-approve -lock-timeout=300s -target="module.${MODULE_NAME}" | tee destroy.txt

      - name: Upload destroy logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: destroy-logs
          path: |
            envs/${{ env.ENVIRONMENT }}/destroy.txt
            envs/${{ env.ENVIRONMENT }}/.terraform.lock.hcl
```

---

### drift-check.yml

```yaml
name: Drift Check

on:
  schedule:
    - cron: "0 2 * * *" # 2 AM daily
  workflow_dispatch: # Allow manual trigger

permissions:
  contents: read
  actions: write

jobs:
  enumerate-and-check:
    runs-on: ubuntu-latest
    env:
      TFPILOT_API_URL: ${{ secrets.TFPILOT_API_URL || 'https://tfpilot.com' }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - name: Fetch Eligible Requests
        id: fetch
        env:
          TFPILOT_WEBHOOK_SECRET: ${{ secrets.TFPILOT_WEBHOOK_SECRET }}
        run: |
          set -euxo pipefail
          if [ -z "$TFPILOT_WEBHOOK_SECRET" ]; then
            echo "Error: TFPILOT_WEBHOOK_SECRET not set"
            exit 1
          fi
          RESPONSE=$(curl -s -H "X-TfPilot-Secret: ${TFPILOT_WEBHOOK_SECRET}" "${TFPILOT_API_URL}/api/requests/drift-eligible" || echo '{"success":false,"requests":[]}')
          echo "eligible_requests<<EOF" >> $GITHUB_OUTPUT
          echo "$RESPONSE" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Filter Core Project Requests
        id: filter
        run: |
          set -euxo pipefail
          ELIGIBLE=$(echo '${{ steps.fetch.outputs.eligible_requests }}' | jq -r '.requests[] | select(.project == "core") | .id' || echo "")
          echo "request_ids<<EOF" >> $GITHUB_OUTPUT
          echo "$ELIGIBLE" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Dispatch Drift-Plan for Each Request
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euxo pipefail
          REQUEST_IDS=$(echo '${{ steps.filter.outputs.request_ids }}' | tr '\n' ' ')
          
          if [ -z "$REQUEST_IDS" ]; then
            echo "No eligible requests found for core project"
            exit 0
          fi
          
          for REQUEST_ID in $REQUEST_IDS; do
            if [ -z "$REQUEST_ID" ]; then
              continue
            fi
            
            sleep 2
            echo "Dispatching drift-plan for request: $REQUEST_ID"
            
            # Get request details to determine environment
            REQUEST_DETAILS=$(curl -s "${TFPILOT_API_URL}/api/requests/${REQUEST_ID}" || echo '{}')
            ENV=$(echo "$REQUEST_DETAILS" | jq -r '.request.environment // "dev"' || echo "dev")
            
            # Dispatch drift-plan workflow
            curl -X POST \
              -H "Accept: application/vnd.github+json" \
              -H "Authorization: Bearer ${GITHUB_TOKEN}" \
              -H "X-GitHub-Api-Version: 2022-11-28" \
              "https://api.github.com/repos/${{ github.repository }}/actions/workflows/drift-plan.yml/dispatches" \
              -d "{
                \"ref\": \"main\",
                \"inputs\": {
                  \"request_id\": \"${REQUEST_ID}\",
                  \"environment\": \"${ENV}\"
                }
              }" || echo "Failed to dispatch for ${REQUEST_ID} (non-fatal)"
            
            # Small delay to avoid rate limits
            sleep 1
          done
```

---

### drift-plan.yml

```yaml
name: Drift Plan

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: "Request ID (required)"
        required: true
        type: string
      environment:
        description: "Environment (dev or prod)"
        required: true
        type: choice
        options:
          - dev
          - prod

permissions:
  id-token: write
  contents: read

jobs:
  drift-plan:
    runs-on: ubuntu-latest
    env:
      ENVIRONMENT: ${{ inputs.environment }}
      REQUEST_ID: ${{ inputs.request_id }}
      TFPILOT_API_URL: ${{ secrets.TFPILOT_API_URL || 'https://tfpilot.com' }}
    defaults:
      run:
        working-directory: envs/${{ env.ENVIRONMENT }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: main

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::420259807324:role/tfplan-connector
          aws-region: eu-west-2
          role-session-name: tfplan-drift

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: |
          set -euxo pipefail
          terraform init -input=false \
            -backend-config="bucket=tfpilot-tfstate-core-${{ env.ENVIRONMENT }}" \
            -backend-config="key=terraform.tfstate" \
            -backend-config="region=eu-west-2" \
            -backend-config="dynamodb_table=tfpilot-tfstate-lock-core-${{ env.ENVIRONMENT }}" \
            -backend-config="encrypt=true"

      - name: Terraform Plan (Drift Detection)
        id: plan
        continue-on-error: true
        run: |
          set +e
          terraform plan -input=false -no-color -lock=false -detailed-exitcode | tee plan.txt
          PLAN_EXIT=$?
          echo "plan_exit_code=$PLAN_EXIT" >> $GITHUB_OUTPUT
          set -e

      - name: Determine Drift Status
        id: drift
        run: |
          PLAN_EXIT=${{ steps.plan.outputs.plan_exit_code }}
          # terraform plan with -detailed-exitcode returns:
          # 0 = no changes, 1 = error, 2 = changes detected
          if [ "$PLAN_EXIT" = "2" ]; then
            echo "has_drift=true" >> $GITHUB_OUTPUT
          else
            echo "has_drift=false" >> $GITHUB_OUTPUT
          fi
          
          # Extract plan summary for reporting
          if grep -q "Plan:" plan.txt 2>/dev/null; then
            PLAN_SUMMARY=$(grep -A 5 "Plan:" plan.txt | head -6 | tr '\n' ' ' | sed 's/  */ /g' || echo "")
            echo "plan_summary<<EOF" >> $GITHUB_OUTPUT
            echo "$PLAN_SUMMARY" >> $GITHUB_OUTPUT
            echo "EOF" >> $GITHUB_OUTPUT
          fi

      - name: Report Drift Result to TfPilot
        if: always()
        env:
          TFPILOT_WEBHOOK_SECRET: ${{ secrets.TFPILOT_WEBHOOK_SECRET }}
        run: |
          set -euxo pipefail
          RUN_ID=${{ github.run_id }}
          RUN_URL="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          HAS_DRIFT=${{ steps.drift.outputs.has_drift }}
          PLAN_SUMMARY="${{ steps.plan.outputs.plan_summary }}"
          
          if [ -z "$TFPILOT_WEBHOOK_SECRET" ]; then
            echo "Warning: TFPILOT_WEBHOOK_SECRET not set, skipping drift result reporting"
            exit 0
          fi
          
          curl -X POST "${TFPILOT_API_URL}/api/requests/${REQUEST_ID}/drift-result" \
            -H "Content-Type: application/json" \
            -H "X-TfPilot-Secret: ${TFPILOT_WEBHOOK_SECRET}" \
            -d "{
              \"runId\": ${RUN_ID},
              \"runUrl\": \"${RUN_URL}\",
              \"hasDrift\": ${HAS_DRIFT},
              \"summary\": \"${PLAN_SUMMARY}\"
            }" || echo "Failed to report drift result (non-fatal)"

      - name: Upload plan logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: drift-plan-logs
          path: |
            envs/${{ inputs.environment }}/plan.txt
            envs/${{ inputs.environment }}/.terraform.lock.hcl
```

---

### plan.yml

```yaml
name: Terraform Plan

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: "TfPilot request ID"
        required: true
        type: string
      environment:
        description: "Environment (dev or prod)"
        required: true
        type: choice
        options:
          - dev
          - prod

concurrency:
  group: core-terraform-${{ inputs.environment }}-${{ inputs.request_id }}
  cancel-in-progress: true

permissions:
  id-token: write
  contents: read

jobs:
  plan:
    runs-on: ubuntu-latest
    env:
      ENVIRONMENT: ${{ inputs.environment }}
    defaults:
      run:
        working-directory: envs/${{ env.ENVIRONMENT }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::420259807324:role/tfplan-connector
          aws-region: eu-west-2
          role-session-name: tfplan-plan

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Debug AWS identity and context
        run: |
          set -euxo pipefail
          aws sts get-caller-identity
          aws configure get region || true
          echo "TF_WORKING_DIR=$(pwd)"
          terraform version
          pwd
          ls -la

      - name: Terraform Init
        run: |
          set -euxo pipefail
          terraform init -input=false \
            -backend-config="bucket=tfpilot-tfstate-core-${{ env.ENVIRONMENT }}" \
            -backend-config="key=terraform.tfstate" \
            -backend-config="region=eu-west-2" \
            -backend-config="dynamodb_table=tfpilot-tfstate-lock-core-${{ env.ENVIRONMENT }}" \
            -backend-config="encrypt=true"

      - name: Terraform Plan
        run: |
          set -euxo pipefail
          # Scope plan to this request's module so only this request's resources appear (not other merged requests on the branch)
          REQUEST_ID="${{ inputs.request_id }}"
          TARGET_ARG=""
          if [ -n "$REQUEST_ID" ]; then
            MODULE_NAME="tfpilot_$(echo "$REQUEST_ID" | sed 's/[^a-zA-Z0-9_]/_/g')"
            TARGET_ARG="-target=module.${MODULE_NAME}"
          fi
          terraform plan -input=false -no-color -lock=false $TARGET_ARG -out=tfplan.binary | tee plan.txt
          terraform show -json tfplan.binary > plan.json

      - name: Upload plan logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: plan-logs
          path: |
            envs/${{ inputs.environment }}/plan.txt
            envs/${{ inputs.environment }}/plan.json
            envs/${{ inputs.environment }}/.terraform.lock.hcl

  infracost:
    name: Infracost cost estimation
    runs-on: ubuntu-latest
    needs: plan
    if: needs.plan.result == 'success'
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    env:
      ENVIRONMENT: ${{ inputs.environment }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check Terraform file changes
        id: tf-changes
        run: |
          git fetch origin main --depth=500 2>/dev/null || git fetch origin master --depth=500 2>/dev/null || true
          BASE=origin/main
          git show-ref -q refs/remotes/origin/main || BASE=origin/master
          set +e
          OUT=$(git diff --name-only $BASE...HEAD -- '**/*.tf' '**/*.tfvars' '**/*.tfvars.json' 2>/dev/null)
          DIFF_EXIT=$?
          if [ $DIFF_EXIT -ne 0 ]; then
            git fetch origin main 2>/dev/null || git fetch origin master 2>/dev/null || true
            OUT=$(git diff --name-only $BASE...HEAD -- '**/*.tf' '**/*.tfvars' '**/*.tfvars.json' 2>/dev/null)
            DIFF_EXIT=$?
          fi
          set -e
          if [ $DIFF_EXIT -ne 0 ] || echo "$OUT" | grep -q .; then
            echo "has_tf_changes=true" >> $GITHUB_OUTPUT
          else
            echo "has_tf_changes=false" >> $GITHUB_OUTPUT
          fi

      - name: Setup Infracost
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        uses: infracost/actions/setup@v3
        with:
          api-key: ${{ secrets.INFRACOST_API_KEY }}

      - name: Download plan artifact
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        uses: actions/download-artifact@v4
        with:
          name: plan-logs

      - name: Generate Infracost cost JSON
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        run: |
          if [ -f "envs/${{ env.ENVIRONMENT }}/plan.json" ]; then
            PLAN_JSON="envs/${{ env.ENVIRONMENT }}/plan.json"
          elif [ -f "plan.json" ]; then
            PLAN_JSON="plan.json"
          else
            echo "::warning::Plan JSON not found, listing workspace:"
            find . -name "plan.json" 2>/dev/null || true
            exit 1
          fi
          infracost breakdown --path="$PLAN_JSON" --format=json --out-file=infracost-cost.json

      - name: Generate Infracost diff JSON
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        run: |
          if [ -f "envs/${{ env.ENVIRONMENT }}/plan.json" ]; then
            PLAN_JSON="envs/${{ env.ENVIRONMENT }}/plan.json"
          else
            PLAN_JSON="plan.json"
          fi
          infracost diff --path="$PLAN_JSON" --format=json --out-file=infracost-diff.json

      - name: Upload Infracost artifacts
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: infracost-cost.json
          path: infracost-cost.json

      - name: Upload Infracost diff artifact
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: infracost-diff.json
          path: infracost-diff.json

      - name: Configure AWS credentials (for S3 upload)
        if: steps.tf-changes.outputs.has_tf_changes == 'true' && inputs.request_id != ''
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::420259807324:role/tfplan-connector
          aws-region: eu-west-2
          role-session-name: tfplan-infracost-s3

      - name: Upload Infracost results to S3
        if: steps.tf-changes.outputs.has_tf_changes == 'true' && inputs.request_id != ''
        env:
          REQUEST_ID: ${{ inputs.request_id }}
          REQUESTS_BUCKET: ${{ vars.TFPILOT_REQUESTS_BUCKET || 'tfpilot-requests' }}
        run: |
          if [ -z "$REQUEST_ID" ]; then exit 0; fi
          if [ ! -f infracost-cost.json ] || [ ! -f infracost-diff.json ]; then
            echo "Infracost JSON files not found, skipping S3 upload"
            exit 0
          fi
          aws s3 cp infracost-cost.json "s3://${REQUESTS_BUCKET}/cost/${REQUEST_ID}/infracost-cost.json" --content-type "application/json"
          aws s3 cp infracost-diff.json "s3://${REQUESTS_BUCKET}/cost/${REQUEST_ID}/infracost-diff.json" --content-type "application/json"
          echo "Uploaded cost artifacts to s3://${REQUESTS_BUCKET}/cost/${REQUEST_ID}/"

      - name: Get PR number
        if: steps.tf-changes.outputs.has_tf_changes == 'true'
        id: pr
        run: |
          PR_NUM=$(gh pr list --head "${{ github.head_ref || github.ref_name }}" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
          echo "number=${PR_NUM}" >> $GITHUB_OUTPUT
          echo "PR number: ${PR_NUM}"

      - name: Post Infracost PR comment
        if: steps.tf-changes.outputs.has_tf_changes == 'true' && steps.pr.outputs.number != ''
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          infracost comment github --path=infracost-diff.json \
            --repo=${{ github.repository }} \
            --github-token="$GITHUB_TOKEN" \
            --pull-request=${{ steps.pr.outputs.number }} \
            --behavior=update
```

---

## 6) Operational invariants (hard rules)

- **RunId guard:** Never patch a request from a `workflow_run` unless `workflow_run.id` matches the request’s tracked runId for that kind (enforced in `patchWorkflowRun`).
- **Monotonic workflow facts:** Once a run reaches `status: completed` or has a non-null `conclusion`, it can never regress to `in_progress` or `queued`, and a concluded run can never be overwritten by an event with `conclusion: null`. Enforced in `patchWorkflowRun`. Protects against out-of-order webhook delivery.
- **Run index TTL:** `expiresAt` is metadata only; S3 does not auto-delete until a lifecycle rule is added on prefix `webhooks/github/run-index/`.
- **SSE only on write:** SSE events are emitted only when a request document was actually written (saved === true); idempotent no-op patch → no write → no SSE.
- **Apply/Destroy serialized per env:** Concurrency group is `*-state-${{ inputs.environment }}` to avoid DynamoDB state lock collisions; do not run concurrent apply or destroy in the same env.
- **Status is derived:** Do not write optimistic status; only facts (pr, runs, approval, mergedSha) are persisted. UI and API derive status via `deriveLifecycleStatus(request)`.

---

## 7) Known failure modes + mitigations

| Failure | Mitigation |
|--------|------------|
| **State lock errors** when multiple apply/destroy in same env | Concurrency group forces serialization per env; document in runbook that only one apply/destroy per env at a time. |
| **Stale/incorrect "destroying"** (no conclusion or wrong correlation) | `destroyTriggeredAt` + 15 min → derive "failed"; `isDestroyRunStale(request)`; UI shows Repair. Sync with `?repair=1` refreshes run. Run index + runId guard avoid wrong request. |
| **Duplicate webhook deliveries** causing write spam | Delivery idempotency (`hasDelivery`); `patchWorkflowRun` returns `{}` when status/conclusion/runId unchanged → `updateRequest` gets same ref → no write. |
| **Cross-request patching** when branch shared | runId guard: patch applied only if `workflow_run.id === trackedRunId`. Run index gives correct requestId for the run that was dispatched. |

---

## 8) How to debug fast

- **DEBUG_WEBHOOKS:** Set env `DEBUG_WEBHOOKS=1` (e.g. in `.env.local` or ECS). Webhook handler logs index resolution (`event=webhook.resolve scope=index kind= runId= requestId=`) and unknown workflow_run (`event=webhook.workflow_run.unknown runId= name= displayTitle=`).
- **S3 prefixes (requests bucket):**  
  - Request docs: `requests/<requestId>.json`.  
  - Run index: `webhooks/github/run-index/<kind>/run-<runId>.json`.  
  - Stream: `webhooks/github/stream.json` (seq + events ring).
- **Resync/repair:**  
  - GET `/api/requests/:requestId/sync` — normal sync (does GitHub calls when `needsRepair(request)`).  
  - GET `/api/requests/:requestId/sync?repair=1` or `?hydrate=1` — force GitHub fetch and patch.  
  - Both require session + GitHub token. Response includes `request` with derived `status` and `sync.mode`.
