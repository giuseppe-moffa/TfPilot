## TfPilot

![Deploy Status](https://github.com/giuseppe-moffa/TfPilot/actions/workflows/deploy.yml/badge.svg)

Terraform self-service platform (Next.js + API) with S3-backed state, GitHub Actions for plan/apply/destroy/cleanup, and an AI-powered assistant for request creation and updates.

**Production URL:** [https://tfpilot.com](https://tfpilot.com)

**Tech stack:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui.

### For users: Sign-in and GitHub App

TfPilot uses GitHub for authentication. If your instance uses a **GitHub App** (not an OAuth App), you must **install the app on your GitHub account** before you can log in:

1. Open the TfPilot GitHub App’s install page (your admin will provide the link, or find it under the app’s **Public page** / **Install App** in GitHub).
2. Click **Install** (or **Configure** if you’ve already installed it).
3. Choose **your user account** (or the organization that owns the repo you use with TfPilot).
4. Select the **repository/repositories** that TfPilot will use (e.g. the Terraform repo for your project).
5. Complete the installation.

After that, go to [tfpilot.com](https://tfpilot.com) (or your instance URL), click **Sign in with GitHub**, and authorize when prompted. Collaborators and non-owners must install the app on their own account for the repos they need; the app must be **public** (Advanced → Make public) so others can install it. UI follows a minimal, background-based design (sections and fields separated with `bg-muted` / `bg-card`, no borders) in light and dark mode.

### Architecture
- **Hosting:** AWS ECS Fargate behind Application Load Balancer (ALB) with HTTPS, deployed via GitHub Actions CI/CD. Infrastructure managed in [tfpilot-terraform](https://github.com/giuseppe-moffa/tfpilot-terraform) repository.
- **Storage:** Requests persisted in S3 (`requests/`), optimistic locking via `version`; destroyed requests archived to `history/`. Cost estimation JSONs (Infracost) stored under `cost/<requestId>/` in the same requests bucket. Assistant state (clarifications, suggestions, patches) stored in request JSON. Lifecycle events logged to S3. Chat logs stored in S3 bucket (e.g., `tfpilot-chat-logs`) with SSE-S3.
- **Auth/RBAC:** Session cookie validation in middleware; prod actions (create/approve/merge/apply/destroy/cleanup dispatch) gated by `TFPILOT_PROD_ALLOWED_USERS` allow-list. Role-based access (viewer/developer/approver/admin) enforced on critical routes. GitHub OAuth for authentication.
- **GitHub:** Workflows for plan/apply/destroy/cleanup dispatched with shared concurrency per project+env+request and OIDC. Cleanup strips only the TfPilot block before destroy. Updates create new PRs and supersede previous ones.
- **UI:** Requests list (filters: status/env/module/project/search, dataset modes: active/drifted/destroyed/all), new request form (project/env/module + config with core/advanced fields), request detail (Overview with metadata and monthly cost estimate, timeline, PR/approve/merge/apply/destroy, suggestions panel, plan diff). Assistant drawer with chat and suggestion panel; design uses background colors only for separation (no borders). AWS Connect at `/aws/connect` for account setup. SWR polling and per-request sync for freshness.
- **AI Assistant:** Schema-driven assistant that guides users through module inputs, provides suggestions (patches), asks clarifications (text/choice/boolean), and helps refine configurations. Assistant state persisted in requests with hash-based validation to prevent stale suggestions.

### Request lifecycle
1) **Create**: User selects project/environment/module → fills form or chats with assistant → submits → request created, Terraform generated, PR opened, plan workflow dispatched.
2) **Update** (optional): User can update request configuration → new revision created → new PR opened → previous PR superseded → plan workflow re-runs.
3) **Plan**: GitHub Actions runs `terraform plan` → results recorded in request → status transitions to `plan_ready`.
4) **Approve**: User/approver approves request → status transitions to `approved`.
5) **Merge**: PR merged → status transitions to `merged`.
6) **Apply**: User triggers apply → GitHub Actions runs `terraform apply` → status transitions to `applying` → `complete` on success or `failed` on error.
7) **Destroy** (optional): User triggers destroy → cleanup PR created (strips TfPilot block) → destroy workflow runs → request archived to `history/`.

**Status transitions** (canonical): `request_created` → `planning` → `plan_ready` → `approved` → `merged` → `applying` → `applied` (or `failed` at any stage). Destroy flow: `destroying` → `destroyed`. Backend may use variants (e.g. `pr_open`, `awaiting_approval`, `complete`); UI normalizes to these for display.

### Workflows (core/payments repos)
- **Plan**: Uses project/env backend, shared concurrency per project+env+request. Runs on request creation and updates. Uploads plan output as artifact; records runId/url/status/conclusion back to request. **Infracost** runs after a successful plan (when Terraform files changed): produces cost and diff JSON, uploads them to S3 `cost/<requestId>/`, and optionally posts/updates a single PR comment with cost summary. Requires `INFRACOST_API_KEY` secret and (for S3 upload) workflow dispatch with `request_id` input; cost is shown in the request Overview in the UI.
- **Apply**: Requires merged PR; prod-guarded; records runId/url/status/conclusion back to request. Uses same concurrency controls as plan.
- **Destroy**: Runs cleanup PR workflow first, then destroy; prod-guarded. Archives request to `history/` after successful destroy.
- **Cleanup**: Strips only the TfPilot module block; branch `cleanup/{requestId}`; can auto-merge in dev. Required before destroy to remove Terraform block.
- **Drift-Plan**: Runs terraform plan on base branch to detect infrastructure drift (dev-only). Scheduled nightly via drift-check workflow. Reports drift status back to TfPilot API.
- **Drift-Check**: Scheduled workflow (2 AM daily) that enumerates eligible dev requests and dispatches drift-plan workflows per request.

### Cost estimation
- **Source:** [Infracost](https://www.infracost.io/) runs inside the Plan workflow in infra repos (core-terraform, payments-terraform) after a successful Terraform plan, only when Terraform files have changed.
- **Storage:** Cost and diff JSONs are uploaded to the same requests bucket at `s3://<bucket>/cost/<requestId>/infracost-cost.json` and `infracost-diff.json`. The app reads these via `GET /api/requests/:id` and sync; no cost data is stored in the request document.
- **UI:** Request detail Overview shows **Cost estimate** with monthly cost (e.g. `Monthly: $11.64`) when data exists; otherwise shows "—".
- **Infra setup:** In the infra repo, add GitHub secret `INFRACOST_API_KEY` and ensure the Plan workflow is dispatched with `request_id` so uploads target the correct path. Optional: set repo variable `TFPILOT_REQUESTS_BUCKET` if the bucket name differs from the default.

### Environment (see `env.example`)
- Buckets/region: `TFPILOT_REQUESTS_BUCKET`, `TFPILOT_CHAT_LOGS_BUCKET`, `TFPILOT_DEFAULT_REGION`
- Prod guardrails: `TFPILOT_PROD_ALLOWED_USERS` (comma-separated GitHub usernames for general prod access), `TFPILOT_DESTROY_PROD_ALLOWED_USERS` (comma-separated GitHub usernames for prod destroy - separate allowlist)
- RBAC: `TFPILOT_ADMINS`, `TFPILOT_APPROVERS` (comma-separated GitHub usernames)
- Policy (optional): `TFPILOT_ALLOWED_REGIONS` (comma-separated regions for module validation)
- Email notifications: `TFPILOT_ADMIN_EMAILS` (comma-separated email addresses), `TFPILOT_EMAIL_FROM` (sender address, must be verified in AWS SES)
- Workflows: `GITHUB_PLAN_WORKFLOW_FILE`, `GITHUB_APPLY_WORKFLOW_FILE`, `GITHUB_DESTROY_WORKFLOW_FILE`, `GITHUB_CLEANUP_WORKFLOW_FILE` (workflow filenames, e.g. `plan.yml`)
- Auth: `AUTH_SECRET`, GitHub OAuth (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT`)

### Deployment

The application is automatically deployed to AWS ECS Fargate via GitHub Actions on every push to the `main` branch. The deployment workflow:

1. Builds a Docker image using a multi-stage build
2. Pushes the image to Amazon ECR
3. Creates a new ECS task definition revision
4. Updates the ECS service to use the new image
5. Waits for the service to stabilize

**Infrastructure:** The AWS infrastructure (VPC, ECS, ALB, Route53, etc.) is managed separately in the [tfpilot-terraform](https://github.com/giuseppe-moffa/tfpilot-terraform) repository. See that repository's README for infrastructure setup and management.

**Manual Deployment:** If needed, you can manually trigger a deployment by:
1. Pushing to the `main` branch, or
2. Using the "Run workflow" button in the GitHub Actions UI

### Running locally
```bash
npm install
npm run dev
```
Ensure env vars above are set (buckets/region, workflow filenames, session secret, allow-list). See `env.example` for required variables.

**Note:** For local development, you'll need:
- AWS credentials configured (for S3 access)
- GitHub OAuth app credentials
- OpenAI API key (if using the AI assistant)

### Scripts
- `npm run dev` — start Next.js dev server
- `npm run build` / `npm run start` — production build and start
- `npm run lint` — ESLint
- `npm run validate:registry` — validate module registry (`config/module-registry.ts`)
- `npm run validate:tags` — validate server tags

### Security & guardrails
- Session validation on all APIs; prod allow-list on approve/merge/apply/destroy/cleanup dispatch.
- Separate prod destroy allowlist (`TFPILOT_DESTROY_PROD_ALLOWED_USERS`) for additional protection against accidental prod resource destruction.
- All request/chat data in S3; chat logs enforced SSE-S3.
- S3 module supports `block_public_access` and `enable_lifecycle` toggles.
- Audit export: Downloadable JSON audit logs for each request (request metadata, lifecycle events, workflow runs).

### AI Assistant Flow
- **Schema-driven**: Assistant uses module registry schema to understand required/optional fields, types, defaults, and constraints.
- **Clarifications**: Assistant asks questions when inputs are ambiguous or missing. Supports text input, choice selection, and boolean (yes/no) responses. Clarifications can include patch operations that apply based on user answers.
- **Suggestions**: Assistant provides configuration suggestions as patches (JSON patch operations). Users can review and selectively apply suggestions. Suggestions include severity (low/medium/high) and descriptions.
- **State management**: Assistant state (clarifications, suggestions, applied patches) persisted in request JSON. Hash-based validation ensures suggestions stay in sync with current configuration. State can be updated via `/api/requests/[requestId]/assistant/state` and clarifications responded to via `/api/requests/[requestId]/clarifications/respond`.
- **Integration**: Assistant helper component in UI provides chat interface; suggestion panel displays patches and clarifications; form-based UI allows direct input with assistant guidance.

### Observability
- **Current**: UI polling (SWR) for list and per-request sync; statuses surfaced for plan/apply/destroy; cleanup PR displayed. Lifecycle events logged to S3 (JSON format) for plan/approve/merge/apply/destroy/cleanup/configuration_updated events. Request detail pages show timeline of events. Downloadable audit logs (JSON export) for compliance and troubleshooting. Admin email notifications (AWS SES) for apply/destroy/plan success and failure events. Passive drift detection (dev-only): nightly terraform plans for successfully applied requests detect infrastructure drift; drift status surfaced in UI with plan run links.
- **Endpoints:** `/api/health`, `/api/metrics` for health and basic metrics.
- **Gaps/TODO:** Slack notifications.
