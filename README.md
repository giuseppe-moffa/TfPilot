## TfPilot

Terraform self-service platform (Next.js + API) with S3-backed state, GitHub Actions for plan/apply/destroy/cleanup, and a guided chat agent for request creation.

### Architecture
- Storage: Requests persisted in S3 (`requests/`), optimistic locking via `version`; destroyed requests archived to `history/`. No tmp files. Chat logs stored in S3 bucket (e.g., `tfpilot-chat-logs`) with SSE-S3.
- Auth/RBAC: Session cookie validation in middleware; prod actions (create/approve/merge/apply/destroy/cleanup dispatch) gated by `TFPILOT_PROD_ALLOWED_USERS` allow-list.
- GitHub: Workflows for plan/apply/destroy/cleanup dispatched with shared concurrency per project+env+request and OIDC. Cleanup strips only the TfPilot block before destroy.
- UI: Requests table with filters (status/env/module/project/search) and detail pages with timeline, actions (approve/merge/apply/destroy), apply/destroy dialogs, and cleanup PR info. SWR polling for freshness and optimistic updates on critical actions.
- Chat agent: Guides users through module inputs, writes chat logs to S3, and uses “yes/no” phrasing for booleans.

### Request lifecycle
1) Create request in UI → plan workflow runs.  
2) Approve → Merge → Apply (UI enforces order; prod allow-list enforced).  
3) Destroy (post-apply) dispatches cleanup PR first, then destroy; destroyed requests archived to `history/`.

### Workflows (core/payments repos)
- Plan: Uses project/env backend, shared concurrency per project+env+request.
- Apply: Requires merged PR; prod-guarded; records runId/url back to request.
- Destroy: Runs cleanup PR workflow first, then destroy; prod-guarded.
- Cleanup: Strips only the TfPilot module block; branch `cleanup/{requestId}`; can auto-merge in dev.

### Environment (see `env.example`)
- Buckets/region: `TFPILOT_REQUESTS_BUCKET`, `TFPILOT_CHAT_LOGS_BUCKET`, `TFPILOT_DEFAULT_REGION`
- Prod guardrails: `TFPILOT_PROD_ALLOWED_USERS` (comma-separated GitHub usernames)
- Workflows: `GITHUB_PLAN_WORKFLOW_FILE`, `GITHUB_APPLY_WORKFLOW_FILE`, `GITHUB_DESTROY_WORKFLOW_FILE`, `GITHUB_CLEANUP_WORKFLOW_FILE`
- Auth: Session secret, GitHub app/OAuth variables for token exchange

### Running locally
```bash
npm install
npm run dev
```
Ensure env vars above are set (buckets/region, workflow filenames, session secret, allow-list).

### Security & guardrails
- Session validation on all APIs; prod allow-list on approve/merge/apply/destroy/cleanup dispatch.
- All request/chat data in S3; chat logs enforced SSE-S3.
- S3 module supports `block_public_access` and `enable_lifecycle` toggles.

### Observability (current state and gaps)
- Current: UI polling (SWR) for list and per-request sync; statuses surfaced for plan/apply/destroy; cleanup PR displayed.
- Gaps/TODO: structured lifecycle logs (JSON) for plan/approve/merge/apply/destroy/cleanup; Slack/email notifications on apply/destroy/plan failure; summary/metrics/health endpoints.
