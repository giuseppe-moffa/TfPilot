# TfPilot EXECUTION PLAN

**Doc index:** [docs/DOCS_INDEX.md](DOCS_INDEX.md). This file is the roadmap (referenced by .cursor rules).

## Mission

TfPilot is an AI-driven Terraform orchestration platform that provides safe, deterministic infrastructure workflows through a GitHub-native lifecycle.

The goal is to evolve TfPilot into a production-grade internal developer platform comparable to env0/Terraform Cloud while remaining lightweight and AI-first.

---

## Current State

- Next.js API + UI
- Requests stored in S3
- Chat agent for request creation
- GitHub workflows for plan/apply/destroy/cleanup
- Deterministic Terraform modules
- Request lifecycle tracking

---

## Principles

- GitHub is the source of truth
- Terraform execution happens only in workflows
- Requests are immutable records
- AI collects inputs, never writes Terraform directly
- Security by default
- Lightweight over complex
- Deterministic modules only

---

## Target Architecture

TfPilot will include:

- Lifecycle logging
- Metrics + observability
- Drift detection
- Policy engine
- Cost estimation
- RBAC roles
- Notification system
- Service catalog UI

---

## Phase 1 — Production Foundation

### Lifecycle Logging

Goal:
Track all request lifecycle events.

Requirements:
- JSON structured logs
- Stored in S3 under logs/
- API endpoint to query logs

Acceptance:
- Every workflow event logged

---

### Drift Detection

Requirements:
- Nightly terraform plan run
- Mark drift in request status
- Send notification

Acceptance:
- Drift surfaced in UI

---

### Notifications

Requirements:
- Slack + email support
- Events: plan failed, apply complete, approval required

Acceptance:
- Notifications triggered on lifecycle events

---

### Metrics Endpoint

Expose:
- total requests
- success rate
- failures
- average apply time

Acceptance:
- /metrics endpoint returns JSON

---

## Phase 2 — Governance & Safety

### Policy Engine

Requirements:
- Pre-plan policy checks
- Naming rules
- Required tags
- Allowed regions

Acceptance:
- Requests blocked if policy fails

---

### RBAC

Roles:
- Viewer
- Developer
- Approver
- Admin

Acceptance:
- Actions restricted by role

---

### Cost Estimation

Requirements:
- Integrate infracost
- Show cost diff in PR + UI

Acceptance:
- Cost shown before apply

---

## Phase 3 — Platform Maturity

### Service Catalog

Requirements:
- Module catalog UI
- Descriptions + inputs + examples

Acceptance:
- Users can browse modules

---

### Request Templates

Acceptance:
- Users can create requests from templates

---

### Environment Promotion

Acceptance:
- Dev → Stage → Prod promotion workflow

---

## Phase 4 — AI Differentiation

### Plan Summarization

Acceptance:
- AI explains terraform plan

---

### Intelligent Suggestions

Acceptance:
- Agent suggests optimizations

---

### Natural Language Queries

Acceptance:
- Users can query platform state via chat

---

## Non-Functional Requirements

- No breaking existing workflows
- Backwards compatible request schema
- Avoid heavy dependencies
- Prefer simple AWS primitives
- Keep infra costs minimal

---

## Definition of Done

A feature is complete when:

- API implemented
- UI updated
- Workflow integration complete
- Logging added
- README updated

---

## Coding Standards

- TypeScript strict
- No any types
- Small composable functions
- Clear error handling
- Avoid duplication

---

## Risks / Constraints

- Must remain lightweight
- Avoid enterprise complexity
- Keep infrastructure costs minimal
