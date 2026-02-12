TfPilot Platform Engineer Review
1. Repository map
TfPilot UI & API (TfPilot repository)
Folder/file	Purpose
tfplan‑ui/	Next.js monorepo providing the chat UI and API endpoints. Key subfolders: app/api/requests (API routes), components/ (React components), config/module‑registry.ts (module catalogue), proxy.ts (auth proxy), login/page.tsx (login page) and tmp/ (temporary chat logs).
app/api/requests/route.ts	POST endpoint to create new infrastructure requests. Validates user inputs against the module registry, builds a module block (named tfpilot_<requestId>), writes Terraform files to the selected environment repository and writes a per‑request JSON to S3. Dispatches a GitHub workflow to run the Terraform plan【246399481472842†L7-L12】.
app/api/requests/[requestId]/apply/route.ts, approve/route.ts, refresh/route.ts	Endpoints for applying, approving and refreshing plans. They call GitHub workflows (e.g., apply.yml) and store status in S3.
components/agent‑chat.tsx	The chat component powering the UI. It displays conversation messages, renders module selection buttons using the module registry and shows plan/apply status. It disables inputs during request creation and shows errors when request creation fails.
app/requests/new/page.tsx	Page where users start a new request. It fetches available modules from the registry and environment list, handles fallback logic if the fetch fails and passes state down to AgentChat.
config/module‑registry.ts	Central definition of the module catalogue. Each entry describes the Terraform module name (e.g. s3‑bucket, sqs‑queue, ecs‑service, iam‑role‑app), required and optional inputs, default values and functions to compute derived attributes and tags【256731336461218†L17-L18】. This registry drives both the UI (module buttons) and backend validation.
proxy.ts	Next.js middleware acting as an auth proxy. It forwards API requests to /api/ after checking authentication tokens and adds GitHub personal access tokens for server‑side calls.
tmp/chat‑logs.json	Sample chat logs used during development to simulate conversation flows; not used in production.
Terraform Repositories (core‑terraform and payments‑terraform)
Folder/file	Purpose
modules/	Terraform modules implementing infrastructure primitives. Example modules: s3‑bucket, sqs‑queue, ecs‑service and iam‑role‑app. Each module contains main.tf, variables.tf, outputs.tf and README.md with inputs/outputs and sets required AWS tags (ManagedBy = tfpilot, TfPilotRequestId, Project, Environment).
envs/dev and envs/prod	Environment roots for each account. Requests add module blocks (e.g., module "tfpilot_<requestId>") into files such as tfpilot.s3.tf and tfpilot.sqs.tf. The module source is always relative (../../modules/<module>), ensuring modules are referenced correctly【246399481472842†L7-L12】.
.github/workflows/plan.yml	GitHub Actions workflow triggered via workflow_dispatch when a request is created. It accepts inputs request_id and environment, checks out the repository, configures AWS credentials using OIDC, runs terraform init and terraform plan, uploads plan logs as artifacts and sets concurrency settings to avoid state lock conflicts【246399481472842†L7-L12】.
.github/workflows/apply.yml (not present in diffs)	Likely similar to plan.yml but runs terraform apply -auto‑approve when the user approves. It must ensure state locking and concurrency are respected.
2. Current end‑to‑end flow

Module selection & chat – A user navigates to /requests/new. The UI loads available modules from module‑registry.ts and displays them as buttons in the chat. The user picks a module (e.g., S3 bucket) and the chat asks for required and optional inputs (project, environment, name, versioning, etc.). The AgentChat component holds conversation state and disables inputs while server actions are running.

Request creation – When the user submits, the UI posts to /api/requests. The backend calls buildModuleConfig which merges user inputs with defaults, strips unknown fields and runs compute functions to derive names and tags. It validates that required fields are provided【256731336461218†L17-L18】. A module block named module "tfpilot_<requestId>" is generated with source = "../../modules/<type>" and variables from the merged config.

Terraform file & metadata generation – The backend writes the module block into the appropriate environment root file (e.g., envs/dev/tfpilot.s3.tf). It creates a JSON file storing the request inputs and computed configuration. This JSON is uploaded to an S3 bucket keyed by the request ID.

Commit & workflow dispatch – Using a GitHub token, the backend commits the new Terraform file and JSON metadata to the environment repository on a feature branch (often tfpilot/<requestId>). It then triggers the plan workflow in the environment repository via workflow_dispatch, passing the request_id and environment inputs. A Pull Request is opened for review.

Terraform plan – The plan.yml workflow checks out the repository, configures AWS credentials with an assumed role, runs terraform init and terraform plan, and uploads the plan output as an artifact. Concurrency groups are set to ${{ github.workflow }}‑${{ github.ref }} to prevent simultaneous plan runs on the same branch【246399481472842†L7-L12】. The plan summary is posted back to the TfPilot UI (via status API or PR comment).

Plan review & approval – In the TfPilot UI, the chat displays the plan diff and allows the user to approve. When approved, the UI calls /api/requests/[requestId]/approve which records the approval in S3 and may leave a PR comment.

Apply – When ready, the user triggers apply. The UI posts to /api/requests/[requestId]/apply. The backend dispatches the apply workflow (similar to plan.yml but running terraform apply -auto‑approve) and updates the request status. After a successful apply, the request is closed, and the environment root now contains the new module permanently.

Refresh & subsequent actions – The refresh endpoint can re‑run the plan to update drift or compute new changes. The chat can display statuses and logs to the user.

3. Top 10 issues / risks (ranked)

Concurrency & state locking – Earlier workflow versions set the concurrency group to core‑terraform-${{ inputs.environment }}, causing all plan runs for an environment to be serialized. Recent updates changed it to ${{ github.workflow }}‑${{ github.ref }}【246399481472842†L7-L12】. This prevents stale runs from interfering with current branches but may still allow multiple workflows to run concurrently against the same Terraform state (e.g., plan and apply on different branches), risking state locking or race conditions. Workflows should use the same concurrency group per environment per repo to serialize both plan and apply.

Module registry vs module definitions – The module registry is manually defined in module‑registry.ts. If Terraform modules evolve (e.g., new variables added or defaults changed), the registry can drift. For example, if the iam‑role‑app module adds a new max_session_duration variable, the registry will not capture it, leading to missing inputs or invalid plans. There is no automated sync between variables.tf and the registry.

Missing apply workflow – The diffs only show plan.yml. Without a dedicated apply.yml, the apply route might reuse plan.yml or run terraform apply directly, risking inconsistent state, missing concurrency controls and no artifact uploads. Apply should be implemented as a separate workflow with appropriate concurrency and state locking.

Duplicate module block names – Module blocks are named tfpilot_<requestId>. If a request is retried or cloned, or if two requests share the same ID due to a bug, duplicate module blocks will appear in tfpilot.tf, causing Terraform to attempt to create the same resources twice. Names should include a timestamp or random suffix to guarantee uniqueness, or the system should check for existing blocks before writing.

Environmental file splitting & merging – Each request writes its own .tf file (tfpilot.s3.tf, tfpilot.sqs.tf, etc.). Over time, the environment directory will accumulate many files. There is no garbage collection when a request is deleted or rolled back. Stale module blocks could remain, causing unused resources to persist. The UI currently has no deletion path.

S3 JSON storage – Request metadata and chat logs are stored in S3 as JSON without encryption or lifecycle policies. If sensitive information (e.g., environment names, secrets or cluster ARNs) is included, this could lead to data exposure. Encryption at rest and automatic expiry of logs should be configured.

UI/Backend mismatch on field names – The registry defines visibility_timeout_seconds for SQS and versioning_enabled for S3. If users input visibilityTimeout or versioningEnabled (camelCase) through the chat, the backend will strip them because it only accepts the exact snake_case keys【256731336461218†L17-L18】. This mismatch can confuse users and cause unnecessary errors.

Slugified module names – buildModuleConfig slugifies the name to lower case, replaces non‑alphanumeric characters with hyphens and truncates to 18 characters【256731336461218†L17-L18】. This may inadvertently produce name collisions or violate AWS naming rules (e.g., S3 buckets require unique names across the account). The module may end up with a truncated name that conflicts with existing resources.

GitHub token & environment separation – The backend uses a GitHub PAT to commit changes and dispatch workflows. If the token lacks proper scopes or is rate‑limited, requests will fail. There is no retry logic or fallback; errors bubble up to the user. Additionally, environment selection (dev/prod) is based on user input and not restricted by RBAC; a user could inadvertently deploy to production.

Lack of error handling in apply/refresh – API routes often assume success and may not handle partial failures. For instance, if the plan workflow fails due to syntax errors, the UI might still allow apply, leading to failed runs. There is no mechanism to surface detailed error messages from GitHub Actions back to the chat.

4. Quick wins (safe, low‑risk fixes)

Unify concurrency groups – Configure both plan and apply workflows to use concurrency.group: "${{ github.workflow }}‑${{ inputs.environment }}". This serializes all runs per environment and prevents simultaneous plan/apply operations on the same state.

Validate module registry against Terraform modules – Write a script that reads each modules/<type>/variables.tf and ensures that module‑registry.ts lists the same variables (required vs optional vs default). Run this script in CI to catch drift.

Add apply.yml workflow – Create a dedicated workflow that mirrors plan.yml but runs terraform apply. Use the same concurrency settings and upload apply logs for traceability.

Enforce unique request IDs – Use a UUID generator rather than deriving IDs from conversation timestamps. Before writing a module file, check the environment repo for existing tfpilot_<id>.tf files and abort if found.

Improve UI validation – Convert user‑friendly input names in the chat (e.g., visibilityTimeout) into the snake_case keys expected by the backend. Show clearer error messages when required fields are missing.

Encrypt and expire S3 objects – Use server‑side encryption (SSE-S3 or SSE-KMS) for chat logs and metadata and set lifecycle rules to delete or archive objects older than a configured retention period.

Add deletion workflow – Implement an endpoint and workflow that can remove a module block and destroy its resources via terraform destroy. This cleans up stale requests and reduces clutter in environment roots.

5. Next changes plan
Phase 1 – Infrastructure correctness & robustness

Finalise workflows – Introduce a proper apply.yml and unify concurrency groups across plan and apply. Add explicit state locking (e.g., use -lock-timeout in terraform plan/apply) to handle race conditions.

Automated module registry sync – Generate module‑registry.ts from variables.tf files in each module. This ensures required/optional/default fields stay aligned with Terraform definitions and reduces manual drift.

Module ID and file management – Adopt UUIDs for request IDs and implement checks to prevent duplicate module blocks. Write module blocks to a single tfpilot.tf file (one per environment) rather than multiple files, or name them with the request ID to avoid collisions. Provide a deletion/destroy path for old modules.

Secure S3 storage – Apply encryption and lifecycle policies to the S3 bucket used for chat logs and request metadata. Remove sensitive data (e.g., cluster ARNs) from logs before storage.

Error propagation & retries – Improve API routes to surface workflow failures (e.g., plan errors, apply failures) back to the UI with meaningful messages. Add retry logic and backoff when GitHub API calls fail due to network or rate limits.

Phase 2 – UI polish & user experience

Adaptive conversation – Make the chat interface more dynamic: auto‑generate prompts based on module definitions, convert friendly input names to the required keys and provide inline documentation for each field.

Environment & project selection – Integrate the environment and project list from a central registry rather than free‑form input. Apply RBAC so that users cannot deploy to unauthorized environments.

Module catalog discovery – Render the module catalogue as cards with descriptions, required inputs and default values. Allow searching and filtering. This helps users understand what each module does without reading the variables.tf.

Improved plan diff display – Instead of showing raw Terraform diff or plan output, parse the plan JSON and present a summarized diff with resource names, actions (create/change/destroy) and cost estimates.

Audit trail & notifications – Provide a dashboard listing all requests, their status (planned, applied, failed) and links to the corresponding PR and workflows. Send notifications (email/Slack) when plans are ready for approval or when applies complete.

This structured review summarises the current architecture, request lifecycle, module integration, workflows and identifies key risks and improvements. Implementing the quick wins and phased plan will improve robustness, correctness and user experience for TfPilot.