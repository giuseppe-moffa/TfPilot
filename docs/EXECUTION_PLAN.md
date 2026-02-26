# TfPilot EXECUTION PLAN (v2)

## Mission

TfPilot is an AI-driven Terraform orchestration platform that provides
safe, deterministic infrastructure workflows through a GitHub-native
lifecycle.

The goal is to evolve TfPilot into a production-grade internal developer
platform comparable to env0 / Terraform Cloud while remaining
lightweight, cost-efficient, and AI-first.

------------------------------------------------------------------------

# Guiding Constraints

-   Keep AWS costs minimal
-   Prefer GitHub-native workflows
-   Avoid heavy infra (no Kubernetes operators, no event buses)
-   Deterministic Terraform only
-   Webhook-first over polling
-   UI-driven safety signals

------------------------------------------------------------------------

# Current State

-   Next.js API + UI
-   Requests stored in S3
-   GitHub Actions for plan/apply/destroy
-   Deterministic Terraform modules
-   Lifecycle tracking
-   Template catalogue

------------------------------------------------------------------------

# Roadmap (Ranked by Fastest Wins First)

------------------------------------------------------------------------

# PHASE 1 --- Fastest Wins (High Impact / Low Cost)

## 1️⃣ Risk Classification Engine

Classify plan before approval: - Safe (adds only) - Medium (modifies) -
Destructive (destroys \> 0)

UI shows risk badge.

Impact: Major enterprise signal\
Infra Cost: None\
Effort: Low (parse plan JSON)

------------------------------------------------------------------------

## 2️⃣ Execution Replay Timeline

Per request: - Who approved - PR merge SHA - Workflow run ID -
Duration - Exit code

Surface from existing logs + GitHub metadata.

Impact: High audit maturity\
Infra Cost: None\
Effort: Low

------------------------------------------------------------------------

## 3️⃣ Concurrency Guard Visualizer

Display: - Environment lock holder - Queue status - Pending operations

Impact: Strong platform engineering signal\
Infra Cost: None\
Effort: Low

------------------------------------------------------------------------

## 4️⃣ Webhook-First Lifecycle

Replace polling with GitHub webhooks for: - Workflow completion - PR
merge - Plan status

Impact: Scalability + API reduction\
Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

## 5️⃣ Approval Rules per Environment

Rules: - Dev → 1 approver - Prod → 2 approvers - Restrict approvers via
GitHub teams

Impact: Governance maturity\
Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

# PHASE 2 --- Safety & Governance

## 6️⃣ Drift Dashboard

Nightly terraform plan per environment: - Show drift count - Last scan
time - Drifted environments summary

Impact: Enterprise readiness\
Infra Cost: Minimal (reuse workflows)\
Effort: Medium

------------------------------------------------------------------------

## 7️⃣ Environment Health Score

Score based on: - Drift presence - Failed applies - Open PRs - Last
successful apply

Display health badge (Green/Yellow/Red).

Impact: Platform differentiation\
Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

## 8️⃣ Metrics Endpoint

Expose: - Total requests - Success rate - Failure rate - Avg apply
time - Drift count

JSON endpoint only (no heavy observability stack).

Impact: Operational visibility\
Infra Cost: None\
Effort: Low

------------------------------------------------------------------------

# PHASE 3 --- Governance Controls

## 9️⃣ Lightweight Policy Engine

Pre-plan validation: - Naming conventions - Required tags - Allowed
regions - Instance type allowlists

Block request if invalid.

Impact: Enterprise safety\
Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

## 🔟 RBAC

Roles: - Viewer - Developer - Approver - Admin

Enforce action restrictions in UI + API.

Impact: Governance maturity\
Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

# PHASE 4 --- Platform Maturity

## Service Catalog Improvements

-   Input previews
-   Example configs
-   Usage stats
-   Template popularity

Infra Cost: None\
Effort: Medium

------------------------------------------------------------------------

## Cost Estimation (Later)

Integrate Infracost in PR: - Show cost diff before approval

Infra Cost: Minimal (GitHub action only)\
Effort: Medium

------------------------------------------------------------------------

# Strategic Avoid List (Costly / Low ROI Now)

-   Kubernetes operator
-   Multi-cloud orchestration
-   Custom runners
-   Event streaming platforms
-   Heavy OPA integration
-   SOC2 tooling early

------------------------------------------------------------------------

# Target Score Trajectory

Current: \~8.3 / 10\
After Phase 1: \~9.0\
After Phase 2: \~9.2\
After Phase 3: \~9.4

------------------------------------------------------------------------

# Definition of Done

A feature is complete when: - API implemented - UI updated - Workflow
integration complete - Logging added - README updated - No infra cost
increase unless justified

------------------------------------------------------------------------

# Coding Standards

-   TypeScript strict
-   No `any`
-   Small composable functions
-   Deterministic behavior
-   Clear error handling
-   Minimal dependencies

------------------------------------------------------------------------

# Core Philosophy

TfPilot should feel like: - Terraform Cloud discipline - GitHub-native
simplicity - AI-assisted but deterministic - Enterprise-grade without
enterprise cost
