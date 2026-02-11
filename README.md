# TfPilot

Terraform self-service platform for GitHub-authenticated engineers to request, plan, and apply infrastructure safely via GitHub Actions and AWS OIDC.

## What it does
- GitHub OAuth login (no local passwords).
- AWS connection via CloudFormation stack (`tfplan-stack.yaml`) that provisions an OIDC-assumable role (`tfplan-connector`).
- Chat-driven “New Request” flow that collects module inputs and writes generated Terraform to target infra repos.
- GitHub Actions:
  - `plan.yml` (workflow_dispatch-enabled) runs Terraform plan per request branch.
  - `apply.yml` (workflow_dispatch) runs Terraform apply after merge.
- Module catalog served from local `terraform-modules/*/metadata.json` (e.g., s3-bucket, sqs-queue, ecs-service) and rendered dynamically in the UI.
- Request timeline with PR link, branch/status, and apply controls.

## Repo layout
- `tfplan-ui/` – Next.js (App Router) frontend + API routes.
- `terraform-modules/` – Module metadata driving the dynamic forms.
- `.github/workflows/` – `plan.yml` and `apply.yml` (OIDC, no static AWS keys).

## Prereqs
- Node 18+ / npm
- AWS account with OIDC role support
- GitHub OAuth app (for login) and repo access for Actions dispatch

## Setup (local)
1) `cd tfplan-ui && npm install`
2) Copy `tfplan-ui/env.example` to `.env.local` and fill in:
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET`
   - `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PLAN_WORKFLOW=plan.yml`, `GITHUB_APPLY_WORKFLOW=apply.yml`
   - `OPENAI_API_KEY` if using the chat assistant
3) Start UI: `npm run dev` (from `tfplan-ui/`)

## AWS connection
- Launch the CloudFormation template at `tfplan-ui/public/tfplan-stack.yaml` (hosted raw on GitHub).
- Template creates OIDC provider (or uses existing) + role `tfplan-connector` with configurable policy and branch scope.

## Workflows
- `plan.yml`: workflow_dispatch + push/PR; assumes `tfplan-connector` via OIDC; runs Terraform plan in target repos.
- `apply.yml`: workflow_dispatch only; assumes `tfplan-connector`; runs Terraform apply in target repos (after merge).

## Security notes
- No static AWS keys; Actions use GitHub OIDC to assume the role.
- Keep secrets in env files or GitHub Actions secrets; do not commit real credentials.
- Generated artifacts (`tmp/*.json`, chat logs) should stay out of git.

## Status
- UI/UX: GitHub login, AWS connect flow, chat-based request wizard, module catalog, timeline with PR/apply buttons.
- Backend: API for requests, modules, chat logs; GitHub branch/PR/workflow dispatch; Terraform file generation per request.

## License
MIT