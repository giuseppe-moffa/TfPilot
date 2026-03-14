# TfPilot Platform Roadmap

Purpose: evolve TfPilot into a production-grade Internal Developer
Platform (IDP) while maximizing development leverage and reducing total
build time.

------------------------------------------------------------------------

# Current Platform State

TfPilot already provides a strong control-plane architecture:

• PR-native Terraform execution\
• Terraform runs only in GitHub Actions\
• S3 canonical request storage\
• Postgres projection/index layer\
• Deterministic lifecycle engine\
• Workspace-first architecture\
• RBAC + project access controls\
• Drift detection foundation\
• \~350 automated tests\
• Webhook run correlation\
• Strong invariant enforcement

Architecture maturity: \~9.7 / 10\
Product maturity: \~8.2 / 10

Target maturity: **\~9.8 platform maturity**

------------------------------------------------------------------------

# Leverage Strategy

Three foundational capabilities unlock most remaining platform features:

1.  Variable Sets / Secrets
2.  Workspace Runs Projection
3.  Workspace Infrastructure Dashboard

Once these exist, many roadmap items become simple UI layers instead of
new backend systems.

------------------------------------------------------------------------

# Phase: Platform Primitives

**Workspace Runs Projection** — Fast workspace-level observability and analytics (projection only; never authoritative).

**Variable Sets** — Reusable configuration inputs across org/project/workspace scopes (deterministic resolution; secrets masked).

**Policy Evaluation** — Governance stage evaluating Terraform plans before approval/apply (advisory + enforcement; not a lifecycle source of truth).

**Cost Governance** — Evaluate Infracost/cost outputs from plans; guardrails (e.g. thresholds, approval requirements); not a lifecycle source of truth.

**Enhanced Workspace Templates** — TfPilot already has Workspace Templates; future work is deeper composition and richer packaged stacks. Enhance Workspace Templates into composable service/environment stacks (e.g. backend-service-template → ECS + ALB + RDS + IAM + Monitoring). Do not use "Environment Templates"; workspace is the environment unit.

**Platform metadata layer** — Workspace metadata as a first-class control-plane primitive (not just tags). Single table `workspace_metadata` (workspace_id, owner_team, service, lifecycle_stage, business_criticality, system_tier, cloud_account_id); optional workspace_dependencies. Unlocks impact graph, blast radius, change intelligence, ownership routing, cost attribution, change sets, risk scoring, dashboards. If you add only one major primitive next, make it this.

------------------------------------------------------------------------

# Phase: Platform Intelligence

### Impact-Aware Infrastructure Changes

**Future capability:** Before infrastructure changes are applied, TfPilot may analyze and display the **operational impact of the change**.

**Examples of information shown:** which workspaces depend on the target workspace; which services may be affected; which teams own impacted systems; cost delta; estimated risk level.

**Example:** Applying to: payments-db-prod. Impacts: payments-api, checkout-service, refunds-worker. Owner teams: payments-platform, commerce-platform. Risk: Tier-1 production dependency; monthly cost +$420; affects 3 downstream workspaces.

**Purpose:** Provide operators and developers with **change intelligence** rather than only raw Terraform plan output.

This capability would rely on metadata, ownership mapping, and workspace relationships. It does not change lifecycle or execution rules.

------------------------------------------------------------------------

# Phase: Change Sets and Rollback Intelligence

### Change Sets with Deterministic Rollback Points

**Future capability:** A Change Set is a future first-class platform object that groups the full deployable unit of a change, including: request; Terraform diff; policy result; cost result; impact summary; execution attempts; rollback target.

**Value:** Instead of thinking only in terms of workspace → run, TfPilot would evolve toward: change set → plan → policy → impact → apply → rollback point.

**Example:** Change Set: cs_payments_db_042. Target workspace: payments-db-prod. Includes: Terraform diff; Cost delta: +$420/month; Policy result: pass; Impacted services: payments-api, checkout-service; Owner teams: payments-platform, commerce-platform. Execution: plan attempt 1, apply attempt 1. Rollback target: git sha abc123, previous applied state marker.

**Minimal conceptual shape:** change_sets — change_set_id, workspace_id, request_id, plan_run_id, apply_run_id, policy_result, cost_result, impact_summary, approved_by, merged_sha, rollback_ref, created_at, completed_at.

**Rollback Anchors (concept):** A rollback reference may be structured as anchors — e.g. `previous_merge_sha`, `previous_apply_run_id`, `terraform_state_snapshot_ref` — giving deterministic rollback without inventing new state.

**Important:** This may start as a projection only. It does not replace S3 request documents as source of truth. It does not change current lifecycle derivation. It builds on request-driven infrastructure changes.

**Why it matters:** Change Sets move TfPilot from Terraform execution toward infrastructure change management.

------------------------------------------------------------------------

# Phase: Deployment Decision Record

### Unified approval object above policy, cost, and impact

**Future capability.** Not just “PR approved, plan passed, policy passed” — a real **deployment decision record**. Before apply, TfPilot would produce one unified object that answers: what is changing; who approved it; what policy said; what cost said; what impact said; what risk level it has; whether it is safe to apply.

**Conceptual shape:** `deployment_decision` — request_id, workspace_id, policy_result, cost_result, impact_result, approved_by, approval_reason, risk_level, created_at.

**Why this matters:** The real control-plane question is **why was this allowed to deploy?** Enterprise platforms need that. Example: “Decision: approved. Reason: policy passed; cost increase under threshold; no tier-1 downstream blast radius; approved by platform owner.” — much stronger than “PR merged, apply succeeded.”

**Fit:** Sits above facts-only lifecycle, projection discipline, impact-aware changes, change sets, and workspace metadata. Does not fight the architecture; sits above it.

**Unlocks:** explainable approvals; safer prod deploys; audit-quality decision history; incident review; cleaner change sets; future auto-approval / auto-block rules. Most tools are run-centric, policy-centric, or PR-centric; TfPilot would become **decision-centric**. With workspace metadata, impact-aware changes, change sets, and this record, TfPilot stops looking like a very good Terraform platform and starts looking like a real **infrastructure change-control system**. That is the 9.8/10 move.

------------------------------------------------------------------------

# Phase 1 --- Variable Sets / Secrets

Reusable configuration across workspaces.

Scopes\
• Organization variables\
• Project variables\
• Workspace variables

Examples\
AWS_ACCOUNT_ID\
TF_VAR_region\
datadog_api_key\
github_token

Features\
• secret masking\
• variable precedence (org \< project \< workspace)\
• injection into GitHub workflows\
• UI management\
• secure storage

Effort: 2--4 days

------------------------------------------------------------------------

# Phase 2 --- Workspace Runs Projection

Introduce workspace_runs projection table in Postgres.

Purpose

Fast queries for:\
• run history\
• activity feeds\
• dashboards\
• analytics

Example schema

workspace_runs\
run_id\
workspace_id\
request_id\
run_type\
status\
conclusion\
created_at\
completed_at\
actor\
repo\
commit_sha

Architecture

GitHub Actions → execution\
S3 → canonical state\
Postgres → fast projections

Effort: 1--2 days

------------------------------------------------------------------------

# Phase 3 --- Workspace Infrastructure Dashboard

Single operational view of a workspace.

Workspace page shows

Workspace: core-dev-ai-agent\
Status: Deployed\
Last Deploy: 2h ago\
Cost: \$184\
Drift: None

Sections

Infrastructure Overview\
Detected Resources\
Recent Runs\
Drift Status\
Cost Summary\
Audit Events

Effort: 2--3 days

------------------------------------------------------------------------

# Phase 4 --- Resource Ownership & Metadata Layer (Platform metadata layer)

**Workspace metadata as a first-class control-plane primitive** — not just tags; a real platform-owned metadata layer. Add one authoritative metadata model per workspace.

Without this primitive, impact-aware changes, ownership routing, cost attribution, dependency graph, change sets, risk scoring, and platform dashboards stay fragmented. With it, they all attach to the same object: the workspace. The architecture already centers on the workspace as Terraform root and state boundary; making workspace metadata first-class is the natural next layer, not a bolt-on. Relatively low effort (one model, simple CRUD/UI, attach to workspace pages); many future features depend on it. **If you add only one major primitive next, make it workspace metadata first-class.**

Single table: **workspace_metadata** (workspace_id, owner_team, service, lifecycle_stage, business_criticality, system_tier, cloud_account_id). For dependencies: a `dependencies[]` (or similar) on workspace_metadata is fine for now; evolve to **workspace_dependencies** (workspace_id, depends_on_workspace_id) for graph queries, indexing, graph visualizations, and Postgres joins.

Purpose

Answer questions like:\
• who owns this workspace?\
• what service does it belong to?\
• what lifecycle stage is it in?\
• how critical is it?\
• what does it depend on?\
• what will this change affect?

Suggested fields

workspace_metadata\
workspace_id\
owner_team\
owner_user\
service\
lifecycle_stage\
business_criticality\
system_tier\
cloud_account_id

Example

Workspace: payments-prod\
Owner Team: payments-platform\
Service: payments-api\
Lifecycle: production\
Criticality: tier-1

Benefits

• cost reporting by team\
• incident routing\
• compliance / audit ownership\
• security accountability\
• filtering all production / tier-1 services

Effort: \~1 day

------------------------------------------------------------------------

# Phase 5 --- Infrastructure Graph

Visual graph of deployed infrastructure.

Example

VPC\
├ ALB\
│ └ ECS Service\
│ └ Containers\
└ RDS Database

Frontend: React Flow / D3.

Effort: 1--2 days

------------------------------------------------------------------------

# Phase 6 --- Policy / Governance Engine

Guardrails using Open Policy Agent (OPA).

Example policies

deny public_s3_bucket\
deny region not allowed\
require tags.environment

Where policies run\
• request creation\
• terraform plan\
• workspace deploy

Effort: 3--5 days

------------------------------------------------------------------------

# Phase 7 --- Cost Governance

Integrate Infracost.

Features\
• plan cost diff\
• monthly estimates\
• workspace cost visibility\
• cost policies

Effort: 1--2 days

------------------------------------------------------------------------

# Phase 8 --- Drift Automation

Automated drift detection.

Workflow

scheduler → list workspaces → terraform plan -refresh-only → detect
drift → update state

Effort: 3--4 days

------------------------------------------------------------------------

# Phase 9 --- Self-Service Infrastructure Catalogue

Developers provision infrastructure products instead of modules.

Examples\
Postgres Database\
Redis Cache\
S3 Storage\
ECS Service\
Kubernetes Namespace

Flow\
catalogue item → workspace template → terraform module

Effort: \~1 week

------------------------------------------------------------------------

# Phase 10 --- Stack Orchestration

Dependency graphs between infrastructure stacks.

Example\
network → cluster → services

Features\
• dependency DAG\
• ordered applies\
• failure propagation

Effort: 5--7 days

------------------------------------------------------------------------

# Phase 11 --- Enterprise SSO

Providers\
Okta\
Auth0\
Azure AD\
WorkOS

Features\
• SAML\
• OIDC\
• SCIM provisioning

Effort: 2--4 days

------------------------------------------------------------------------

# Phase 12 --- Multi-Account / Multi-Cloud Environment Management

Add a cloud account control plane.

Schema addition

cloud_accounts\
account_id\
provider\
name\
credentials_ref

Workspaces reference\
cloud_account_id\
region

Benefits\
• manage multiple AWS accounts\
• map environments to accounts\
• governance across environments\
• enterprise cloud control plane

Effort: 2--3 days

------------------------------------------------------------------------

# Optimized Development Order

1 Variable Sets / Secrets\
2 Workspace Runs Projection\
3 Infrastructure Dashboard\
4 Resource Ownership & Metadata\
5 Infrastructure Graph\
6 Policy Engine\
7 Cost Governance\
8 Drift Automation\
9 Infrastructure Catalogue\
10 Stack Orchestration\
11 Enterprise SSO\
12 Multi-Account / Multi-Cloud Management

------------------------------------------------------------------------

# Estimated Effort

Variable Sets --- 2--4 days\
Runs Projection --- 1--2 days\
Dashboard --- 2--3 days\
Ownership Metadata --- \~1 day\
Infra Graph --- 1--2 days\
Policy Engine --- 3--5 days\
Cost Governance --- 1--2 days\
Drift Automation --- 3--4 days\
Catalogue --- \~1 week\
Stack Orchestration --- 5--7 days\
SSO --- 2--4 days\
Multi-Account Management --- 2--3 days

------------------------------------------------------------------------

# Platform Rating

Architecture: **9.7 / 10**\
Current Product maturity: **8.2 / 10**

After roadmap completion:

**\~9.8 / 10 platform maturity**

Comparable with

Terraform Cloud\
Spacelift\
env0

------------------------------------------------------------------------

# Architecture Principle --- Workspace Sharding

TfPilot scales infrastructure by **adding more workspaces**, not by
increasing the size of a workspace.

Each workspace represents:

• a Terraform root\
• a Terraform state boundary\
• a deploy boundary\
• a drift boundary\
• a destroy boundary\
• an ownership boundary

Example scaling pattern:

network-prod ↓ cluster-prod ↓ payments-service-prod ↓ payments-db-prod

Instead of creating a single large Terraform state containing many
services, TfPilot encourages **workspace sharding**.

Benefits

• smaller Terraform states\
• faster plans\
• isolated drift\
• safer destroy\
• parallel deployments\
• clear ownership boundaries

Future platform features such as **Stack Graph orchestration** will
allow multiple workspaces to be composed safely without merging
Terraform states.

Scaling rule

TfPilot scales by:

**more workspaces --- not bigger workspaces**

------------------------------------------------------------------------

# Architecture Principle --- Projection Discipline

TfPilot may add more projections over time (workspace_runs, change_sets, cost views, impact views), but each must remain: derived; rebuildable; non-authoritative. Scale platform intelligence by adding projections, not by moving lifecycle truth out of authoritative request facts.
