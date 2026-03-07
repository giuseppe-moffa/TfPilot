# Architecture Delta: Environment Templates (Model 2 Add-on)

Status: **Implemented** (Phases 0–6 complete)  
Scope: Adds **Environment Templates** and **Deploy Environment** (baseline bundle) while keeping **Request Templates** unchanged. Design spec; implementation in `config/environment-templates.ts`, `lib/environments/`, `app/api/environments/`, `app/api/environment-templates/`.

---

## 0. Goal

Provide a fast, opinionated way to stand up a new environment using:

- **1 PR** for the baseline (“Deploy Environment”)
- **N request files**, one per module, under the env root
- The same PR-native plan/apply lifecycle, approval flow, and facts-only invariants as single-request flows

This is an additive feature on top of **Model 2 Environments** (ENV_ROOT + one file per request).

---

## 1. Key Terms

- **Environment**: A target root `envs/<environment_key>/<environment_slug>/` with isolated state.
- **Request**: A single module instantiation rendered to `tfpilot/requests/<module>_req_<request_id>.tf` (see §6.1).
- **Request Template**: Existing system. **1 template = 1 module** shortcut. Stored in S3 `templates/request/...`.
- **Environment Template**: New system. **1 template = N modules** baseline bundle. Stored separately (see §11).

User-facing naming:
- “Create Environment” (DB only, no PR)  
- “Deploy Environment” (opens PR that creates env skeleton + baseline request files)

---

## 2. Field Naming & Schema

Align with existing database fields. Do **not** introduce `environment_template_id`.

| Entity      | Field          | Meaning                                                   | Nullable/Optional |
|-------------|----------------|-----------------------------------------------------------|-------------------|
| Environment | `template_id`  | Environment template used during creation (e.g. blank, baseline-ai-service) | Yes (null = not from template) |
| Request     | `template_id`  | Template used for that request (request template or environment template baseline) | Yes (null = ad-hoc) |
| Request     | `deployment_id`| Groups requests created by a single Deploy Environment operation | Yes (null = not from deploy) |

Rules:
- `environments.template_id` = environment template ID used when creating the environment.
- `requests.template_id` = template used for that request; same field for both request templates and baseline deployment.
- `deployment_id` = UUID grouping N requests created by one Deploy; nullable for non-deploy requests.
- `template_id` on request is optional for ad-hoc (non-template) requests.

---

## 3. UX Flow

### 3.1 Create Environment (Instant)
Inputs:
- `project_key`
- `environment_key` (e.g. dev/prod)
- `environment_slug` (user-defined name)
- `template_id` (one of: blank | baseline-ai-service | baseline-app-service | baseline-worker-service)

Creates:
- Environment row (Postgres) only, with `template_id` stored

No repo writes.

### 3.2 Deploy Environment (PR-Native)

Action from environment detail page. Must follow the **same lifecycle as normal requests**.

Flow:
1. Create N request docs (S3)
2. Create skeleton env files (in-memory for PR payload)
3. Open **one PR** containing skeleton + N request files
4. **PR requires review/approval** (same as single-request PRs)
5. **Plan runs automatically** (via existing workflow)
6. **Apply runs after merge** (user-initiated or CI)

**Plan/apply scope:** Deploy PR runs **plan at ENV_ROOT scope** (full environment), not per-request. It must **not rely on a single request_id**. Plan/apply must reflect the **entire env root change set**. The workflow must run Terraform against:

```
envs/<environment_key>/<environment_slug>/
```

and **not** target individual request files.

**PR-native approval (non-negotiable):**
- Deploy **does not auto-merge**
- Deploy **does not bypass approval**
- Deploy PR must follow the **same review process** as single-request PRs
- Apply occurs **after merge**, following the existing lifecycle

Deploy simply creates a **bundled PR** that follows the standard PR-native lifecycle.

Gating:
- “New Request” must be blocked until environment has been deployed (env root exists in git).

---

## 4. Environment Root Skeleton (Always included in Deploy PR)

Deploy PR creates (if missing):
- `envs/<key>/<slug>/backend.tf` (generic backend block; key injected by workflows)
- `envs/<key>/<slug>/providers.tf`
- `envs/<key>/<slug>/versions.tf`
- `envs/<key>/<slug>/tfpilot/base.tf`
- `envs/<key>/<slug>/tfpilot/requests/.gitkeep`

---

## 5. Baseline Template Definitions

**Baseline philosophy:** Baseline templates should only provision **structural infrastructure** that is universally required for services (e.g. logs, IAM, storage, container registry). Application-specific configuration such as secrets or parameters must be created later using normal requests. **Secrets are created via AWS Secrets Manager requests**, not baseline deployment.

Principles:
- Baselines should be **minimal**, **cheap**, and **broadly reusable**
- Avoid networking-heavy or app-specific runtime resources in v1
- Baseline should enable “run a service later” without locking architecture too early
- **No secrets, parameters, or KMS** in baseline; platform standard is AWS Secrets Manager, created via normal requests

All baseline items are expressed as:
- `module` (module registry type)
- `defaultConfig` (partial; merged like request templates)
- `order` (deterministic file creation order; Terraform itself is dependency-driven)

**Module availability:** Baselines reference only:
- `ecr-repo`
- `s3-bucket`
- `cloudwatch-log-group`
- `iam-role`

If a module does not exist in the registry yet, mark it **“requires module implementation”** and omit from v1 baselines until implemented.

### 5.1 Template: `blank`
- Modules: **[]** (empty)
- Purpose: create env root only; user adds modules via normal requests.

### 5.2 Template: `baseline-ai-service`
Target: “agents/workers/services that run containers and need storage/logs/iam”

| Order | Module               | Requires module implementation |
|-------|----------------------|-------------------------------|
| 1     | ecr-repo             | No (exists)                   |
| 2     | cloudwatch-log-group | Yes                           |
| 3     | iam-role             | Yes                           |
| 4     | s3-bucket            | No (exists)                   |

### 5.3 Template: `baseline-app-service`
Target: “web app service baseline without forcing ALB/VPC choices”

| Order | Module               | Requires module implementation |
|-------|----------------------|-------------------------------|
| 1     | cloudwatch-log-group | Yes                           |
| 2     | iam-role             | Yes                           |
| 3     | s3-bucket            | No (exists)                   |

### 5.4 Template: `baseline-worker-service`
Target: “batch/cron/queue consumers”

| Order | Module               | Requires module implementation |
|-------|----------------------|-------------------------------|
| 1     | cloudwatch-log-group | Yes                           |
| 2     | iam-role             | Yes                           |
| 3     | s3-bucket            | No (exists)                   |

### 5.5 Example: Baseline vs Later Requests

**Environment:** dev / ai-agent  
**Template:** baseline-ai-service

**Baseline Deploy PR creates:**
- `envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_a12bc3.tf` (container registry)
- `envs/dev/ai-agent/tfpilot/requests/cloudwatch-log-group_req_b34de4.tf` (CloudWatch)
- `envs/dev/ai-agent/tfpilot/requests/iam-role_req_f98e11.tf` (task role)
- `envs/dev/ai-agent/tfpilot/requests/s3-bucket_req_88cd2a.tf` (storage)

**Later requests created by users (normal requests):**
- secrets-manager-secret (e.g. OPENAI_API_KEY)
- ecs-service
- redis
- sqs

This clarifies that secrets belong in normal requests, not baseline deployment.

---

## 6. Request Creation Semantics (Baseline bundle)

### 6.1 Request File Naming (Canonical Format)

Request files use the **canonical format**:

```
tfpilot/requests/<module>_req_<request_id>.tf
```

**Examples:**
```
envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_a12bc3.tf
envs/dev/ai-agent/tfpilot/requests/iam-role_req_f98e11.tf
envs/dev/ai-agent/tfpilot/requests/s3-bucket_req_88cd2a.tf
```

**Rules:**
- `<module>` must match the **module registry key** (e.g. `ecr-repo`, `s3-bucket`, `iam-role`).
- `<module>` must be **slug-safe**: `[a-z0-9-]` only.
- `<request_id>` remains the **canonical identifier** used by the system (from DB/S3).
- The request ID is **not derived from filename**; the filename is derived from `(module, request_id)`.

**Purpose:** Improves repository readability, PR review clarity, and debugging of env contents.

**Destroy/cleanup:** Must compute filenames using `<module>_req_<request_id>.tf`, not just the request ID.

**Deploy detection:** Files matching this format are used to detect deployed environments (see §9).

---

### 6.2 Deploy Environment generates

- `deployment_id` (UUID)
- N standard Request docs (S3) with:
  - `environment_id`, `environment_key`, `environment_slug`
  - `module`, `config`
  - `deployment_id`
  - `template_id` (environment template ID, e.g. baseline-ai-service)

Repo PR contains N files:
- `envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf` for each request (see §6.1)

Execution:
- Plan/apply runs **once** for the env root (not per request).

UI:
- Requests created via deployment show a “Deployed” badge and template name.
- Requests remain normal: can be updated/destroyed individually later.

---

## 7. Branch Naming Convention

Deploy PR branch format:

```
deploy/<environment_key>/<environment_slug>
```

Examples:
- `deploy/dev/ai-agent`
- `deploy/prod/payment-api`

### 7.1 Branch Naming Conflict Rule

**Detection method:** GitHub branch lookup and GitHub PR lookup.

| Condition | Response | Error code |
|-----------|----------|------------|
| Deploy branch already exists **or** deploy PR is open | 409 Conflict | `ENV_DEPLOY_IN_PROGRESS` |
| GitHub API checks fail (timeout, rate limit, API error) | 503 Service Unavailable | `ENV_DEPLOY_CHECK_FAILED` |

**Branch exists or PR open:** If a deploy branch already exists OR a deploy PR is open, the API returns **409 Conflict** with error code `ENV_DEPLOY_IN_PROGRESS`.

**Clarification:** Branch-only and PR-open states are intentionally treated the same to simplify user experience. The system returns `ENV_DEPLOY_IN_PROGRESS` in both cases.

**GitHub checks fail:** The deploy endpoint **must fail closed** and return **503 Service Unavailable** with error code `ENV_DEPLOY_CHECK_FAILED`. Failing closed prevents multiple deploy PRs being created simultaneously when branch state cannot be verified.

---

## 8. Deploy Atomicity & Failure Handling

Deploy must be **atomic**. If any step fails, previous steps must be rolled back.

**If request docs are created but PR creation fails:**
- Delete the created request docs (S3)
- Return error to caller
- Deployment must not leave orphan request docs

**Validation checklist (before any writes):**
0. Verify environment exists in DB
1. Verify environment is not archived
2. Verify environment is not already deployed (using `*_req_*.tf` pattern; see §9)
3. Validate `template_id` (must be known template or blank; see below)
4. Verify no deploy branch already exists (see §7.1)
5. Verify no open PR exists from deploy branch (see §7.1)

**Invalid `template_id`:** If `template_id` is provided but does **not match any supported environment template**, the endpoint must return **400 Bad Request** with error code `INVALID_ENV_TEMPLATE`. Valid template IDs are those returned by `GET /api/environment-templates`.

**Only after all validations pass:**
6. Create N request docs in S3
7. Generate skeleton + N request files
8. Create branch
9. Commit files
10. Open PR

If step 8–10 fails → delete request docs from step 6, return error.

---

## 9. Deployed Environment Detection

The skeleton includes `tfpilot/requests/.gitkeep`; therefore **folder existence alone cannot be used** (would cause false positives for envs that have only the skeleton).

Environment is considered **deployed only when at least one file matching** `*_req_*.tf` **exists inside**:

```
envs/<environment_key>/<environment_slug>/tfpilot/requests/
```

This aligns exactly with the canonical file naming rule defined in **§6.1** (`<module>_req_<request_id>.tf`). `.gitkeep` and other non-request files **must be ignored**.

**Matching logic:**
- Matching is **case-sensitive** and follows the canonical naming rule in §6.1.
- Only files matching `<module>_req_<request_id>.tf` (i.e. containing `_req_`) count toward deploy detection.
- **Files that must be ignored:** `.gitkeep`; non-request Terraform files; any file that does not contain `_req_`.

This prevents false positives (e.g. env with only `.gitkeep` is not deployed).

**Do NOT** introduce a DB status field. Use git path existence as the source of truth.

---

## 10. Redeploy Rules

If the environment already has request files (i.e. at least one `*_req_*.tf` exists in `tfpilot/requests/` per §9 detection rule):

- `POST /api/environments/:id/deploy` must return **409 Conflict** with error code `ENV_ALREADY_DEPLOYED`
- Redeploying baseline is **not supported in v1**

---

## 11. Storage & APIs

### 11.1 Environment Templates storage (v1 → v2)

**v1 (intentional, reduces complexity):**
- `config/environment-templates.ts` (static list)
- No S3, no admin CRUD; templates are code-defined

**v2 (future):**
- S3 bucket (same bucket OK) with separate prefix:
  - `templates/environment/index.json`
  - `templates/environment/<id>.json`
- Aligns with request templates for admin-editable env templates

### 11.2 API surface (proposed)
- `GET /api/environment-templates` → list enabled templates
- `POST /api/environments` (create env, DB only) accepts `template_id`
- `POST /api/environments/:id/deploy` → opens PR (skeleton + baseline requests); returns 409 if already deployed

---

## 12. Catalogue Scope

Environment templates are **NOT** part of the existing request template catalogue.

**For v1**, environment templates are used only in:
- Environment creation flow (template selection when creating env)
- Environment detail page deploy action (Deploy button)

The catalogue (`/catalogue`) continues to show **request templates only**.

---

## 13. Ordering & Constraints

Must remain true:
- Facts-only lifecycle invariants untouched
- PR-native execution intact
- One file per request remains the only Terraform write model
- No Terraform workspaces
- ENV_ROOT canonical

Atomicity rules:
- Deploy PR must include **both** env skeleton + baseline request files (no half state).
- If PR creation fails after creating request docs, delete request docs and return error.

---

## 14. Non-goals (v1)

- Template upgrades/migrations
- Partial deployments (“pick some baseline modules”)
- Auto-merge of PRs
- Redeploy / baseline update
- Multi-env workflows
- Networking stacks (VPC/ALB/ACM) baked into baselines

---

## 15. Implementation Notes (high level)

- Treat Deploy as a “bundle PR creator” reusing existing PR creation utilities.
- **Skeleton generation must not live in the API route.** Skeleton content should live in a reusable helper such as `lib/terraform/envSkeleton.ts`. The deploy route should only call the helper and include skeleton files in the PR payload. This keeps skeleton generation reusable and testable.
- Reuse the same config merge rules as request templates:
  - module defaults → baseline defaultConfig → any request-time overrides
- Keep all baseline defaults minimal; avoid setting `name/project/env/request_id` in defaultConfig.
- Branch naming: `deploy/<environment_key>/<environment_slug>` (see §7).
