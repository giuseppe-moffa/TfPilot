# TfPilot EXECUTION PLAN V2

## Mission
Evolve TfPilot into a production-ready, AI-first Terraform platform with strong governance, observability, and UX, while staying lightweight and GitHub-native.

## Current State (done)
- Next.js API + UI; requests stored in S3
- Chat agent for request creation (schema-driven allowlists)
- GitHub workflows for plan/apply/destroy/cleanup; cleanup PR surfaced
- Deterministic Terraform modules; centralized module registry/schema endpoint
- Lifecycle logging to S3; UI timeline; metrics endpoint
- Policy basics: naming regex, allowed regions; runtime policy to agent/UI
- RBAC: viewer/developer/approver/admin enforced on critical routes

## Phase 1 — Governance & Safety (high priority)
1) Drift Detection  
   - Nightly plan per request/env; mark drift status; surface in UI; optional notify.
2) Notifications  
   - Slack/email for: plan failed, apply complete, approval required, drift detected.
3) Cost Estimation  
   - Infracost integration; show cost diff in PR and UI pre-apply.
4) Policy Engine Hardening  
   - Enforce required tags, allowed regions, naming; block on policy fail.  
   - Audit trail of policy failures.

## Phase 2 — Platform Maturity
1) Service Catalog  
   - Catalog UI: module descriptions, inputs, examples; request-from-catalog flow.
2) Request Templates  
   - Predefined templates per module/env; fast path to request creation.
3) Environment Promotion  
   - Dev → Stage → Prod workflow with approvals; reuse artifacts/plan where possible.
4) Notifications UX  
   - User-level notification preferences (Slack/email).

## Phase 3 — AI Differentiation
1) Plan Summarization  
   - AI-generated summary of Terraform plan in UI/PR.
2) Intelligent Suggestions  
   - Agent suggests safer/cheaper options (e.g., block public access, cost hints).
3) Natural Language Queries  
   - Query platform state (requests, statuses, drift, costs) via chat.

## Phase 4 — Observability & Ops
1) Metrics Expansion  
   - Add per-module/per-env breakdowns, p95 apply time, drift counts.
2) Logging/Tracing  
   - Correlate request → workflow run → log stream; searchable logs for agent/API.
3) Runbook Hooks  
   - Standardized links to playbooks for common failures (plan/apply/drift).

## Cross-Cutting Standards
- Keep module schema authoritative (registry + schema endpoint); agent/backend allowlist.
- Security defaults: block public by default, encryption on by default; explicit opt-outs.
- No breaking existing workflows; backwards-compatible request schema.
- Lightweight first: prefer simple AWS/Terraform primitives; minimal cost.

## Definition of Done
A feature is complete when:
- API implemented, validated against policy/schema
- UI/agent updated (schema-driven)
- Workflow integration done (plan/apply/destroy/cleanup as applicable)
- Logging/metrics added; notifications where relevant
- Docs updated; tests for validation/edge cases
