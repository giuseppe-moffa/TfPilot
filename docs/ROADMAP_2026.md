
# TfPilot Platform Roadmap

Author: Internal
Purpose: Strategic roadmap for evolving TfPilot into a full Internal Developer Platform (IDP)

---

# Current State

TfPilot already provides a strong control-plane architecture:

- PR-native Terraform execution
- Terraform runs only in GitHub Actions
- S3 canonical request documents
- Postgres projection/index layer
- Deterministic lifecycle engine
- Workspace-first architecture
- RBAC + project access controls
- Drift detection foundation
- ~350 automated tests
- Webhook-driven run correlation
- Lifecycle invariants enforced by tests

Architecture maturity: ~9.4/10  
Platform feature maturity: ~8/10

---

# Strategic Goal

Transform TfPilot into a complete internal developer platform comparable to env0 / Spacelift.

Target maturity: **9.8 / 10**

---

# Major Platform Feature Gaps

| Feature | Status |
|--------|--------|
| Variable Sets / Secrets | Missing |
| Policy Engine | Missing |
| Workspace Run History | Partial |
| Cost Governance | Missing |
| Drift Automation | Partial |
| Stack Orchestration | Missing |
| Enterprise SSO | Missing |
| Infrastructure Catalogue | Partial |

---

# Updated Feature Roadmap

## Phase 1 — Variable Sets / Secrets

Purpose: reusable configuration across workspaces.

Scopes:

- Organization variables
- Project variables
- Workspace variables

Examples:

- AWS_ACCOUNT_ID
- TF_VAR_region
- datadog_api_key
- github_token

Features:

- secret masking
- variable precedence (org < project < workspace)
- inject variables into GitHub workflows
- UI management
- secure secret storage

Effort: **2–4 days**

Impact: **Very high**

---

## Phase 2 — Policy / Governance Engine

Add infrastructure guardrails before deploy/apply.

Technology: Open Policy Agent (OPA)

Example policies:

- deny public S3 buckets
- enforce required tags
- restrict regions
- require encryption

Integration points:

- plan
- apply
- workspace deploy

UI:

- policy results visible in PR
- compliance panel on workspace page

Effort: **3–5 days**

Impact: **Enterprise readiness**

---

## Phase 3 — Workspace Run History

Expose full run history per workspace.

Runs recorded:

- preview
- deploy
- destroy
- drift
- request runs

Workspace page shows:

- run timeline
- run logs
- plan outputs
- resource summaries

Storage:

runs/<workspace_id>/<run_id>/

Effort: **2–3 days**

Impact: **Major UX improvement**

---

## Phase 4 — Cost Governance

Integrate Infracost.

Features:

- plan cost diff
- monthly cost estimate
- workspace cost visibility
- cost threshold policies

Example:

deny if monthly_cost > $1000

UI:

- cost before
- cost after
- cost delta

Effort: **1–2 days**

---

## Phase 5 — Drift Automation

Automate drift detection across all workspaces.

Workflow:

scheduler  
→ list workspaces  
→ terraform plan -refresh-only  
→ detect drift  
→ update platform state

Implementation:

GitHub scheduled workflows.

Effort: **3–4 days**

---

## Phase 6 — Infrastructure Catalogue

Developers provision infrastructure via products instead of Terraform modules.

Example catalogue:

- Postgres database
- Redis cache
- S3 storage
- ECS service
- Kubernetes namespace

Implementation:

catalogue item → workspace template → Terraform module

Effort: **~1 week**

Impact: **Major UX improvement**

---

## Phase 7 — Stack Orchestration

Support multi-stack dependency graphs.

Example:

network  
→ cluster  
→ services

Features:

- dependency DAG
- ordered applies
- stack lifecycle management

Effort: **5–7 days**

---

## Phase 8 — Enterprise SSO

Enterprise authentication integrations.

Providers:

- Okta
- Auth0
- Azure AD
- WorkOS

Features:

- SAML
- OIDC
- SCIM provisioning

Effort: **2–4 days**

---

# Recommended Development Order

1. Variable Sets / Secrets
2. Policy Engine
3. Workspace Run History
4. Cost Governance
5. Drift Automation
6. Infrastructure Catalogue improvements
7. Stack orchestration
8. Enterprise SSO

---

# Estimated Effort

| Feature | Time |
|--------|------|
Variable Sets | 2–4 days |
Policy Engine | 3–5 days |
Workspace Run History | 2–3 days |
Cost Governance | 1–2 days |
Drift Automation | 3–4 days |
Catalogue Improvements | ~1 week |
Stack Orchestration | 5–7 days |
Enterprise SSO | 2–4 days |

Total estimated effort:

~3–4 weeks of focused development.
