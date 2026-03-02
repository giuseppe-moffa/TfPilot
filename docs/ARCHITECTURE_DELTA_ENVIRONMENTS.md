# Architecture Delta: Environments (PR-Native, Deterministic)

**Design/proposal doc. Not yet implemented.** Describes a future environment-centric UX. Current architecture: request-centric with `environment_key` (string) on requests only.

---

## Goal
Introduce a first-class **Environment** entity to make TfPilot environment-centric (env0-style UX) while preserving the existing **Request** model as the immutable change/audit unit.

This delta must not change truth semantics:
- Lifecycle status remains **derived from facts** (no authoritative stored status).
- Attempts remain **created only on dispatch**; webhooks/sync only patch facts.
- PR/merge SHA remain the execution source of truth.
- S3 remains the authoritative store for full request documents + artifacts.
- Postgres is used for **indexing and querying** only.

See Tier-A invariants in [docs/INVARIANTS.md](INVARIANTS.md).

---

## Current State (as of 2026-03)

TfPilot is **request-centric**:
- Users create a Request for project + environment (string key, e.g. dev/prod) + module.
- Request lifecycle is derived from facts in the request document.
- UI lists Requests (`/requests`) and shows detail per Request. Primary nav is Requests.
- **`requests_index`** has `environment_key` (TEXT) — a string on each row, not an FK. No `environments` table.
- **`/environments`** page exists as a **placeholder** only ("Environment management coming soon"). No `/api/environments` or Environment entity.
- Environment is a **field on the request** (e.g. `request.environment`), not a first-class domain object.

---

## What Changes
### 1) Add Environment as a first-class domain object
An **Environment** is a durable target for infrastructure changes.
Requests now belong to an Environment.

**Environment is the primary navigation object.**
Request remains the immutable change record for auditability and determinism.

### 2) Add Environment Indexing in Postgres
Environments are stored in Postgres for fast list/filter and aggregation.
Environment "status" is still derived (from last known request facts + computed rules).

### 3) Add an Environment summary view
Environment list shows:
- last deployment time
- last request summary
- derived health (derived, not stored truth)
- drift/cost flags (future)

---

## Non-Negotiable Constraints
### C1: No authoritative environment status column
Environment status must not become stored truth.
If a cached projection is introduced later, it must be recomputable from facts and treated as non-authoritative.

### C2: Requests remain the sole source of lifecycle truth
Environment does not own the full lifecycle state machine; it aggregates.
All lifecycle gating (apply/destroy enablement) remains driven by request facts + deriveLifecycleStatus.

### C3: PR-native workflow remains core
Environment actions (Deploy/Destroy/Redeploy) always map to creating/advancing a Request that:
- creates PR
- produces plan
- merges
- applies/destroys
No direct out-of-band applies.

---

## Domain Model
### Environment
A durable grouping for:
- repo/project
- environment key (dev/stage/prod)
- module set or template family (optional)
- owner metadata
- default policies/approvals (optional)

### Request (unchanged conceptually)
An immutable unit of change that:
- is rendered deterministically
- ties to PR/merge SHA
- tracks run attempts
- derives lifecycle from facts

Relationship:
- **Environment 1 → N Requests**
- Each Environment has a “latestRequestId” pointer (optional convenience)

---

## Postgres Tables (Minimum)
### `environments`
- environment_id TEXT PRIMARY KEY
- project_key TEXT NOT NULL            (e.g., "core")
- repo_full_name TEXT NOT NULL         (e.g., org/repo)
- environment_key TEXT NOT NULL        (dev/stage/prod)
- display_name TEXT NULL
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL
- archived_at TIMESTAMPTZ NULL

Indexes:
- (repo_full_name, environment_key)
- (project_key)

### `environment_pointers` (optional, can be columns on environments)
- environment_id TEXT PRIMARY KEY
- latest_request_id TEXT NULL
- last_deployed_at TIMESTAMPTZ NULL

### `requests_index` changes (add environment_id)
- environment_id TEXT NULL (FK-like, but keep soft for flexibility)

⚠️ No environment_status column as authoritative truth.

---

## Read Paths
### Environment list
- Query Postgres `environments`
- Join latest request metadata from `requests_index` (if present)
- Derived fields (computed at read-time):
  - `derivedStatus`: computed from latest request facts where needed
  - `needsApproval`: computed from latest request derived status + facts
  - `lastActivityAt`: from requests_index

### Environment detail
- Show environment metadata (Postgres)
- Show list of recent requests (Postgres index)
- Request detail remains S3-backed

---

## Write Paths
### Create Environment
- Insert into `environments`

### Create Request for Environment
- Persist request to S3 as today
- Upsert `requests_index` with environment_id

### Updates
- Any request mutation updates:
  - S3 request doc (authoritative)
  - requests_index updated_at + metadata
- Environment updated_at can be touched when:
  - request created
  - request completes (optional)
But environment does not own lifecycle truth.

---

## UX Behavior (What Users Experience)
- Primary nav shifts to **Environments**
- Each environment row shows:
  - derived state (from latest request)
  - last deploy time
  - action buttons (Deploy/Redeploy/Destroy) that create a new request

Requests remain visible as:
- environment history
- immutable audit trail

---

## Migration Plan (PR-by-PR)
### PR A — DB schema + API scaffolding
- migrations: environments table (+ add environment_id to requests_index)
- API:
  - GET /api/environments
  - POST /api/environments
  - GET /api/environments/:id (metadata + recent requests)

### PR B — UI: Environments list + link to existing request pages
- new page: /environments
- clicking an environment shows its requests (reusing existing components)

### PR C — Create Request “from Environment”
- add “Deploy” button on env that creates a request pre-filled with env context
- request flow stays identical

---

## Rollback Plan
- Environments are additive.
- If removed, Requests still function as the primary object.
- S3 request docs remain authoritative; no data loss.

---

## Future (Out of Scope)
- TTL auto-destroy
- Drift scans
- Cost estimation
- Policy packs / OPA
- Multi-IaC support

Terraform-only, PR-first remains the product lane.