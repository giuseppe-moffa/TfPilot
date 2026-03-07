# TfPilot Platform Roadmap

**Author:** Internal\
**Purpose:** Strategic roadmap for evolving TfPilot from an internal
Terraform orchestration platform into a full Internal Developer Platform
(IDP).

------------------------------------------------------------------------

# Current State

TfPilot already provides a strong **control-plane architecture**:

-   GitHub PR--driven infrastructure execution
-   Terraform runs only in GitHub Actions
-   S3 canonical request documents
-   Postgres projection/index layer
-   Deterministic lifecycle derived from facts
-   Multi-org architecture
-   RBAC + project access controls
-   Environment lifecycle management
-   Request lifecycle engine
-   Drift detection foundation
-   \~350 automated tests
-   Deterministic sync / reconciliation model

**Architecture maturity:** \~9/10\
**Platform feature maturity:** \~7.5/10

------------------------------------------------------------------------

# Core Architecture Principles

TfPilot follows several strong platform invariants:

-   Terraform execution occurs **only in GitHub Actions**
-   Infrastructure lifecycle state is **derived from facts**
-   **S3 is canonical state**
-   **Postgres is projection only**
-   **Operations must be deterministic**
-   **Control plane and execution plane are separated**

This architecture resembles platforms like Spacelift more than Terraform
Cloud.

------------------------------------------------------------------------

# Strategic Goal

Transform TfPilot into a **self‑service internal developer platform**
where developers can provision infrastructure safely and independently.

Target maturity: **8.8--9 / 10 platform maturity**.

------------------------------------------------------------------------

# Major Platform Feature Gaps

  Feature                                 Status
  --------------------------------------- ---------
  Audit Activity Stream                   Planned
  Policy Engine                           Missing
  Cost Governance                         Missing
  Drift Automation                        Partial
  Stack Orchestration                     Missing
  Enterprise SSO                          Missing
  Self‑Service Infrastructure Catalogue   Partial

------------------------------------------------------------------------

# Feature Roadmap

## Phase 1 --- Audit Activity Stream

Purpose: platform observability, traceability, compliance.

### Features

-   Append‑only audit log
-   Org‑scoped activity feed
-   Actor attribution
-   Mutation event tracking

### Example events

-   org_created
-   org_archived
-   team_created
-   team_member_added
-   project_access_granted
-   request_created
-   request_applied
-   environment_deploy_pr_opened

### Storage

Postgres table:

    audit_events

Append‑only model.

### Effort

**2--3 days**

### Cost

**£0**

------------------------------------------------------------------------

# Phase 2 --- Cost Governance

Integrate **Infracost**.

### Features

-   Terraform plan cost estimation
-   Cost thresholds
-   Policy guardrails

Example rule:

    deny if monthly_cost > $1000

### Effort

**1--2 days**

### Cost

\~£0--£10/month

------------------------------------------------------------------------

# Phase 3 --- Drift Automation

Fully automate infrastructure drift detection.

### Workflow

    scheduler
        ↓
    list environments
        ↓
    terraform plan -refresh-only
        ↓
    detect drift
        ↓
    update platform state

### Implementation

-   GitHub scheduled workflows
-   Drift result ingestion

### Effort

**3--4 days**

### Cost

\~£5--£20/month (GitHub Actions)

------------------------------------------------------------------------

# Phase 4 --- Policy Engine

Add infrastructure guardrails using **OPA (Open Policy Agent)**.

### Example policies

-   enforce encryption
-   require tags
-   restrict regions
-   require approval for production

Example rule:

    deny if resource.public == true

### Effort

**3--5 days**

### Cost

£0 (open source)

------------------------------------------------------------------------

# Phase 5 --- Stack Orchestration

Support multi‑stack infrastructure dependency graphs.

Example:

    network
       ↓
    cluster
       ↓
    services

### Features

-   dependency DAG
-   ordered apply
-   stack lifecycle management

### Effort

**5--7 days**

### Cost

£0

------------------------------------------------------------------------

# Phase 6 --- Enterprise SSO

Add enterprise authentication integrations.

Options:

-   SAML
-   OIDC
-   SCIM provisioning

Providers:

-   WorkOS
-   Auth0
-   Okta
-   Azure AD

### Effort

**2--4 days**

### Cost

£0--£30/month (depending on provider)

------------------------------------------------------------------------

# High Impact Feature --- Self‑Service Infrastructure Catalogue

This is the **single feature that most increases platform maturity
perception.**

Developers provision infrastructure via **products**, not Terraform
modules.

Example catalogue:

    Postgres Database
    Redis Cache
    S3 Storage
    ECS Service
    Kubernetes Namespace

Behind the scenes:

    catalogue item → Terraform module

### Benefits

-   Developer self‑service
-   Guardrails via policy
-   Consistent infrastructure standards

### Implementation

-   module schema → form generator
-   catalogue UI
-   template versioning
-   guardrail integration

### Effort

\~1 week

------------------------------------------------------------------------

# Recommended Development Order

1.  Audit Activity Stream
2.  Cost Governance
3.  Drift Automation
4.  Policy Engine
5.  Catalogue UX improvements
6.  Stack Orchestration
7.  Enterprise SSO

------------------------------------------------------------------------

# Estimated Effort Summary

  Feature                  Time
  ------------------------ -----------
  Audit Stream             2--3 days
  Cost Governance          1--2 days
  Drift Automation         3--4 days
  Policy Engine            3--5 days
  Catalogue Improvements   \~1 week
  Stack Orchestration      5--7 days
  Enterprise SSO           2--4 days

Total estimated effort:

**\~2--3 weeks of focused development** (solo with Cursor).

------------------------------------------------------------------------

# Expected Platform Maturity After Roadmap

  Platform                  Maturity
  ------------------------- ------------
  Terraform Cloud           10
  Spacelift                 9.5
  env0                      9
  TfPilot (after roadmap)   **8.8--9**

------------------------------------------------------------------------

# Long Term Optional Enhancements

Future features not required for initial maturity:

-   Compliance export / SIEM integration
-   Real‑time audit stream
-   Platform analytics dashboards
-   Multi‑VCS support
-   Cross‑org platform admin audit

------------------------------------------------------------------------

# Conclusion

TfPilot already has a **strong control plane architecture**.

The remaining work focuses primarily on **feature layers**, not core
infrastructure.

By implementing the roadmap above, TfPilot can evolve into a **fully
capable internal developer platform** while maintaining its
deterministic architecture.
