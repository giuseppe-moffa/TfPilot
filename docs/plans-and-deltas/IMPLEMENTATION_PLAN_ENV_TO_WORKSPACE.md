
# IMPLEMENTATION_PLAN_ENV_TO_WORKSPACE.md

## Goal
Refactor TfPilot terminology and domain model from **Environment** to **Workspace** while preserving the existing architecture and invariants.

Target model:

Organization
└── Project
    └── Workspace
        └── Request

No live production data needs preservation, so a clean hard refactor is allowed.

---

# Platform invariants (must NOT change)

- Terraform execution occurs **only in GitHub Actions**
- S3 request documents remain the **canonical source of truth**
- Lifecycle/status are **fact‑derived**
- Postgres is a **projection / query store**, not lifecycle authority
- Control plane behavior must remain **deterministic and idempotent**

---

# Phase 1 — Database schema

## Goal
Rename the Environment persistence layer to Workspace.

## Changes
Rename table and columns.

Table:
- environments → workspaces

Columns:
- environment_id → workspace_id
- environment_key → workspace_key
- environment_slug → workspace_slug

Projection updates:
- requests_index.environment_key → workspace_key
- requests_index.environment_slug → workspace_slug
- requests_index.environment_id → workspace_id

## Definition of done
- Migration runs successfully
- Schema compiles
- No code changes yet

---

# Phase 2 — DB access layer

## Goal
Update database access helpers.

## Files
lib/db/environments.ts → lib/db/workspaces.ts

Rename exported functions:

- createEnvironment → createWorkspace
- getEnvironment → getWorkspace
- listEnvironments → listWorkspaces
- updateEnvironment → updateWorkspace
- deleteEnvironment → deleteWorkspace

## Definition of done
- All DB helpers compile
- Queries reference new table/columns

---

# Phase 3 — Domain logic

## Goal
Rename environment domain layer.

## Files
lib/environments/* → lib/workspaces/*

Examples:

- computeEnvRoot → computeWorkspaceRoot
- validateCreateEnvironmentBody → validateCreateWorkspaceBody
- getEnvironmentDeployStatus → getWorkspaceDeployStatus
- isEnvironmentDeployed → isWorkspaceDeployed

## Definition of done
- Domain layer compiles
- No environment terminology left

---

# Phase 4 — Request resolution

## Goal
Update request resolution helpers.

## Files
lib/requests/resolveRequestEnvironment.ts  
→ resolveRequestWorkspace.ts

Fields renamed:

- environment_key → workspace_key
- environment_slug → workspace_slug
- environment_id → workspace_id

## Definition of done
- Requests resolve workspace correctly

---

# Phase 5 — API routes

## Goal
Rename API route surface.

Routes:

/api/environments → /api/workspaces
/api/environments/[id] → /api/workspaces/[id]
/api/environments/[id]/deploy → /api/workspaces/[id]/deploy
/api/environments/[id]/destroy → /api/workspaces/[id]/destroy
/api/environments/[id]/activity → /api/workspaces/[id]/activity

## Definition of done
- API compiles
- Route tests updated

---

# Phase 6 — RBAC rename

## Goal
Align permission helpers.

Changes:

deploy_env → deploy_workspace

Functions:

- userCanDeployEnv → userCanDeployWorkspace

## Definition of done
- Permission helpers compile
- RBAC tests pass

---

# Phase 7 — Request document schema

## Goal
Update request document fields.

Fields:

- environment_key → workspace_key
- environment_slug → workspace_slug
- environment_id → workspace_id

S3 request docs can be recreated since no production data exists.

## Definition of done
- Request creation uses workspace fields

---

# Phase 8 — GitHub workflow dispatch

## Goal
Rename workflow inputs.

Inputs:

- environment_key → workspace_key
- environment_slug → workspace_slug

Ensure dispatch logic sends the new fields.

## Definition of done
- Workspace deploy triggers workflow successfully

---

# Phase 9 — UI pages

Phase 9 — UI pages
Goal

Introduce Project-first navigation and place Workspaces inside Projects.

Rename Environment UI to Workspace UI while restructuring the page hierarchy.

Navigation structure
Projects
  → core
     → Workspaces
        → dev
        → prod
  → payments
     → Workspaces
        → dev
        → prod

Requests
Catalogue
Insights
Settings
Routes

Project routes:

/projects
/projects/[projectId]

Workspace routes:

/projects/[projectId]/workspaces
/projects/[projectId]/workspaces/[workspaceId]
/projects/[projectId]/workspaces/new
Page responsibilities

/projects

Shows all projects in the organization.

Columns:

Project name

Repo

Workspace count

Created

/projects/[projectId]

Project overview page.

Sections:

Workspaces
Access / Teams
Project Settings

Primary action:

Create Workspace

/projects/[projectId]/workspaces

List of workspaces inside the project.

Columns:

Key
Name
Status
Created

/projects/[projectId]/workspaces/[workspaceId]

Workspace detail page.

Sections:

Overview
Requests
Drift
Activity
Settings
UI text renames
Environment → Workspace
Environments → Workspaces
Create Environment → Create Workspace
Deploy Environment → Deploy Workspace
Destroy Environment → Destroy Workspace
Environment Templates → Workspace Templates
Definition of done

Sidebar shows Projects as the primary entry

Workspaces appear inside project pages

Workspace pages render correctly

No remaining "Environment" terminology in UI

Navigation hierarchy matches:

Organization
  → Project
      → Workspace
          → Request

---

# Phase 10 — Navigation

## Goal
Update sidebar.

Old:

- Environments

New:

- Workspaces

Final sidebar:

- Projects
- Workspaces
- Requests
- Catalogue
- Insights
- Settings

## Definition of done
- Navigation works

---

# Phase 11 — Tests

## Goal
Update test suite.

Search/replace:

environment → workspace

Update:

- route tests
- domain tests
- RBAC tests

## Definition of done
- Full test suite passes

---

# Phase 12 — Documentation

## Goal
Update canonical docs.

Files:

- SYSTEM_OVERVIEW.md
- RBAC.md
- ORGANISATIONS.md
- API.md
- POSTGRES_INDEX.md
- OPERATIONS.md
- plans-and-deltas/AUDIT_ACTIVITY_STREAM_MVP_PLAN.md (audit_events.environment_id → workspace_id)

Terminology:

Environment → Workspace

Add note explaining the rename. Explicitly reflect that `audit_events.environment_id` is now `workspace_id`.

## Definition of done
- Docs match the new architecture

---

# Deployment order

1. Update infra repo workflows (workspace inputs)
2. Deploy TfPilot refactor
3. Verify end‑to‑end flow

Test scenario:

Create Workspace → Deploy → Create Request → Plan → Apply
