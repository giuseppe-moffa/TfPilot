# TfPilot Platform Roadmap (v4)

Purpose: evolve TfPilot into a production-grade Internal Developer Platform (IDP)
while maximizing development leverage and reducing total build time.

---

# Current Platform State

TfPilot already provides a strong control-plane architecture:

• PR-native Terraform execution  
• Terraform runs only in GitHub Actions  
• S3 canonical request storage  
• Postgres projection/index layer  
• Deterministic lifecycle engine  
• Workspace-first architecture  
• RBAC + project access controls  
• Drift detection foundation  
• ~350 automated tests  
• Webhook run correlation  
• Strong invariant enforcement  

Architecture maturity: ~9.7 / 10  
Product maturity: ~8.2 / 10

Target maturity: **~9.8 platform maturity**

---

# Leverage Strategy

Three foundational capabilities unlock most remaining platform features:

1. Variable Sets / Secrets
2. Workspace Runs Projection
3. Workspace Infrastructure Dashboard

Once these exist, many roadmap items become simple UI layers instead of new backend systems.

---

# Phase 1 — Variable Sets / Secrets

Reusable configuration across workspaces.

Scopes  
• Organization variables  
• Project variables  
• Workspace variables  

Examples  
AWS_ACCOUNT_ID  
TF_VAR_region  
datadog_api_key  
github_token  

Features  
• secret masking  
• variable precedence (org < project < workspace)  
• injection into GitHub workflows  
• UI management  
• secure storage  

Effort: 2–4 days

---

# Phase 2 — Workspace Runs Projection

Introduce workspace_runs projection table in Postgres.

Purpose

Fast queries for:  
• run history  
• activity feeds  
• dashboards  
• analytics  

Example schema

workspace_runs  
run_id  
workspace_id  
request_id  
run_type  
status  
conclusion  
created_at  
completed_at  
actor  
repo  
commit_sha  

Architecture

GitHub Actions → execution  
S3 → canonical state  
Postgres → fast projections

Effort: 1–2 days

---

# Phase 3 — Workspace Infrastructure Dashboard

Single operational view of a workspace.

Workspace page shows

Workspace: core-dev-ai-agent  
Status: Deployed  
Last Deploy: 2h ago  
Cost: $184  
Drift: None  

Sections

Infrastructure Overview  
Detected Resources  
Recent Runs  
Drift Status  
Cost Summary  
Audit Events  

Effort: 2–3 days

---

# Phase 4 — Resource Ownership & Metadata Layer

Add platform-level ownership metadata to workspaces.

Purpose

Answer questions like:  
• who owns this workspace?  
• what service does it belong to?  
• what lifecycle stage is it in?  
• how critical is it?  

Suggested fields

workspace_metadata  
workspace_id  
owner_team  
owner_user  
service  
lifecycle_stage  
business_criticality  

Example

Workspace: payments-prod  
Owner Team: payments-platform  
Service: payments-api  
Lifecycle: production  
Criticality: tier-1  

Benefits

• cost reporting by team  
• incident routing  
• compliance / audit ownership  
• security accountability  
• filtering all production / tier-1 services  

Effort: ~1 day

---

# Phase 5 — Infrastructure Graph

Visual graph of deployed infrastructure.

Example

VPC  
 ├ ALB  
 │   └ ECS Service  
 │       └ Containers  
 └ RDS Database  

Frontend: React Flow / D3.

Effort: 1–2 days

---

# Phase 6 — Policy / Governance Engine

Guardrails using Open Policy Agent (OPA).

Example policies

deny public_s3_bucket  
deny region not allowed  
require tags.environment  

Where policies run  
• request creation  
• terraform plan  
• workspace deploy  

Effort: 3–5 days

---

# Phase 7 — Cost Governance

Integrate Infracost.

Features  
• plan cost diff  
• monthly estimates  
• workspace cost visibility  
• cost policies  

Effort: 1–2 days

---

# Phase 8 — Drift Automation

Automated drift detection.

Workflow

scheduler → list workspaces → terraform plan -refresh-only → detect drift → update state

Effort: 3–4 days

---

# Phase 9 — Self-Service Infrastructure Catalogue

Developers provision infrastructure products instead of modules.

Examples  
Postgres Database  
Redis Cache  
S3 Storage  
ECS Service  
Kubernetes Namespace  

Flow  
catalogue item → workspace template → terraform module

Effort: ~1 week

---

# Phase 10 — Stack Orchestration

Dependency graphs between infrastructure stacks.

Example  
network → cluster → services

Features  
• dependency DAG  
• ordered applies  
• failure propagation  

Effort: 5–7 days

---

# Phase 11 — Enterprise SSO

Providers  
Okta  
Auth0  
Azure AD  
WorkOS  

Features  
• SAML  
• OIDC  
• SCIM provisioning  

Effort: 2–4 days

---

# Phase 12 — Multi-Account / Multi-Cloud Environment Management

Add a cloud account control plane.

Schema addition

cloud_accounts  
account_id  
provider  
name  
credentials_ref  

Workspaces reference  
cloud_account_id  
region  

Benefits  
• manage multiple AWS accounts  
• map environments to accounts  
• governance across environments  
• enterprise cloud control plane  

Effort: 2–3 days

---

# Optimized Development Order

1 Variable Sets / Secrets  
2 Workspace Runs Projection  
3 Infrastructure Dashboard  
4 Resource Ownership & Metadata  
5 Infrastructure Graph  
6 Policy Engine  
7 Cost Governance  
8 Drift Automation  
9 Infrastructure Catalogue  
10 Stack Orchestration  
11 Enterprise SSO  
12 Multi-Account / Multi-Cloud Management

---

# Estimated Effort

Variable Sets — 2–4 days  
Runs Projection — 1–2 days  
Dashboard — 2–3 days  
Ownership Metadata — ~1 day  
Infra Graph — 1–2 days  
Policy Engine — 3–5 days  
Cost Governance — 1–2 days  
Drift Automation — 3–4 days  
Catalogue — ~1 week  
Stack Orchestration — 5–7 days  
SSO — 2–4 days  
Multi-Account Management — 2–3 days

---

# Platform Rating

Architecture: **9.7 / 10**  
Current Product maturity: **8.2 / 10**

After roadmap completion:

**~9.8 / 10 platform maturity**

Comparable with

Terraform Cloud  
Spacelift  
env0
