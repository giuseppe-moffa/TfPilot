## TfPilot

![Deploy Status](https://github.com/giuseppe-moffa/TfPilot/actions/workflows/deploy.yml/badge.svg)

Terraform self-service platform (Next.js + API) with S3-backed state, GitHub Actions for plan/apply/destroy/cleanup, and an AI-powered assistant for request creation and updates.

**Production URL:** [https://tfpilot.com](https://tfpilot.com)

### Architecture
- **Hosting:** AWS ECS Fargate behind Application Load Balancer (ALB) with HTTPS, deployed via GitHub Actions CI/CD. Infrastructure managed in [tfpilot-terraform](https://github.com/giuseppe-moffa/tfpilot-terraform) repository.
- **Storage:** Requests persisted in S3 (`requests/`), optimistic locking via `version`; destroyed requests archived to `history/`. Assistant state (clarifications, suggestions, patches) stored in request JSON. Lifecycle events logged to S3. Chat logs stored in S3 bucket (e.g., `tfpilot-chat-logs`) with SSE-S3.
- **Auth/RBAC:** Session cookie validation in middleware; prod actions (create/approve/merge/apply/destroy/cleanup dispatch) gated by `TFPILOT_PROD_ALLOWED_USERS` allow-list. Role-based access (viewer/developer/approver/admin) enforced on critical routes. GitHub OAuth for authentication.
- **GitHub:** Workflows for plan/apply/destroy/cleanup dispatched with shared concurrency per project+env+request and OIDC. Cleanup strips only the TfPilot block before destroy. Updates create new PRs and supersede previous ones.
- **UI:** Form-based request creation with assistant drawer; requests table with filters (status/env/module/project/search); detail pages with timeline, suggestions panel, clarifications, actions (approve/merge/apply/destroy), apply/destroy dialogs, and cleanup PR info. SWR polling for freshness and optimistic updates on critical actions.
- **AI Assistant:** Schema-driven assistant that guides users through module inputs, provides suggestions (patches), asks clarifications (text/choice/boolean), and helps refine configurations. Assistant state persisted in requests with hash-based validation to prevent stale suggestions.

### Request lifecycle
1) **Create**: User selects project/environment/module → fills form or chats with assistant → submits → request created, Terraform generated, PR opened, plan workflow dispatched.
2) **Update** (optional): User can update request configuration → new revision created → new PR opened → previous PR superseded → plan workflow re-runs.
3) **Plan**: GitHub Actions runs `terraform plan` → results recorded in request → status transitions to `plan_ready`.
4) **Approve**: User/approver approves request → status transitions to `approved`.
5) **Merge**: PR merged → status transitions to `merged`.
6) **Apply**: User triggers apply → GitHub Actions runs `terraform apply` → status transitions to `applying` → `complete` on success or `failed` on error.
7) **Destroy** (optional): User triggers destroy → cleanup PR created (strips TfPilot block) → destroy workflow runs → request archived to `history/`.

**Status transitions**: `created` → `pr_open` → `planning` → `plan_ready` → `awaiting_approval` → `approved` → `merged` → `applying` → `complete` (or `failed` at any stage). Destroy flow: `destroying` → `destroyed`.

### Workflows (core/payments repos)
- **Plan**: Uses project/env backend, shared concurrency per project+env+request. Runs on request creation and updates. Uploads plan output as artifact; records runId/url/status/conclusion back to request.
- **Apply**: Requires merged PR; prod-guarded; records runId/url/status/conclusion back to request. Uses same concurrency controls as plan.
- **Destroy**: Runs cleanup PR workflow first, then destroy; prod-guarded. Archives request to `history/` after successful destroy.
- **Cleanup**: Strips only the TfPilot module block; branch `cleanup/{requestId}`; can auto-merge in dev. Required before destroy to remove Terraform block.
- **Drift-Plan**: Runs terraform plan on base branch to detect infrastructure drift (dev-only). Scheduled nightly via drift-check workflow. Reports drift status back to TfPilot API.
- **Drift-Check**: Scheduled workflow (2 AM daily) that enumerates eligible dev requests and dispatches drift-plan workflows per request.

### Environment (see `env.example`)
- Buckets/region: `TFPILOT_REQUESTS_BUCKET`, `TFPILOT_CHAT_LOGS_BUCKET`, `TFPILOT_DEFAULT_REGION`
- Prod guardrails: `TFPILOT_PROD_ALLOWED_USERS` (comma-separated GitHub usernames for general prod access), `TFPILOT_DESTROY_PROD_ALLOWED_USERS` (comma-separated GitHub usernames for prod destroy - separate allowlist)
- RBAC: `TFPILOT_ADMINS`, `TFPILOT_APPROVERS` (comma-separated GitHub usernames)
- Email notifications: `TFPILOT_ADMIN_EMAILS` (comma-separated email addresses), `TFPILOT_EMAIL_FROM` (sender address, must be verified in AWS SES)
- Workflows: `GITHUB_PLAN_WORKFLOW_FILE`, `GITHUB_APPLY_WORKFLOW_FILE`, `GITHUB_DESTROY_WORKFLOW_FILE`, `GITHUB_CLEANUP_WORKFLOW_FILE`
- Auth: Session secret, GitHub app/OAuth variables for token exchange

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
- **Gaps/TODO**: Slack notifications; summary/metrics/health endpoints; cost estimation.
