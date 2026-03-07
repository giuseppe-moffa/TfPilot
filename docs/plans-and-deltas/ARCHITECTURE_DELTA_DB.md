# Architecture Delta: Postgres Index (PR-Native, Deterministic Control Plane)

**Design doc for the Postgres index migration. Current canonical schema and behavior: [docs/POSTGRES_INDEX.md](POSTGRES_INDEX.md).**

---

## Goal
Add a Postgres-backed **index** for fast querying (lists, filters, insights) while keeping TfPilot’s PR-native, deterministic lifecycle model unchanged.

This delta must not change how TfPilot determines truth:
- lifecycle status remains **derived from facts**
- run execution remains **attempt-based**
- webhook + correlation remain **monotonic and idempotent**
- S3 remains the store for request documents and artifacts

(See Tier-A invariants.) :contentReference[oaicite:2]{index=2}

---

## Current State (v2 baseline)
**Authoritative request document + facts live in S3**.
UI and API compute lifecycle status from the request facts:
- list derives status server-side
- detail derives status client-side
- sync response injects derived status but does not persist it

Forensic validation confirms:
- `request.status` is not persisted and is not trusted as a source of truth
- derived lifecycle is consistently used for display + gating
- attempts are created only at dispatch
- monotonic patching is enforced for webhook/sync updates
- run correlation prefers the run-index path first

(See forensic report.) :contentReference[oaicite:3]{index=3}

---

## What Changes in This Delta
### 1) Add Postgres as a **metadata index**
Postgres becomes the authoritative source for:
- request list rows (stable ordering, filtering)
- basic aggregates (counts by derived status computed at read-time or via safe projection)

Postgres is **not** the authoritative store for the full request document.

### 2) Keep S3 as the authoritative request document store
S3 remains authoritative for:
- full request JSON document (facts)
- run artifacts/logs/plan outputs
- any large payloads

### 3) Add write-through indexing on request mutations
Any time TfPilot writes the request document to S3, it also upserts a row in Postgres for list/indexing.

---

## Non-Negotiable Constraints
### C1: Lifecycle status MUST NOT become stored truth
- No endpoint may treat a stored status column as authoritative.
- Postgres schema MUST NOT include a lifecycle status column used as truth.
- If a derived status is cached for query convenience, it must be treated as a non-authoritative projection that can be recomputed.

Invariant reference: “Lifecycle status is derived from facts only.” :contentReference[oaicite:4]{index=4}

### C2: Attempts are created only on dispatch
- Webhooks/sync may update attempt facts but must not create attempts or modify `currentAttempt`.

### C3: Patching is monotonic and idempotent
- late/out-of-order webhook events cannot regress completed attempts
- delivery idempotency remains enforced

Invariant reference: Tier-A invariants + webhook correlation rules. :contentReference[oaicite:5]{index=5} :contentReference[oaicite:6]{index=6}

### C4: Run correlation remains run-index first
- webhook correlation must check run-index before fallbacks

Invariant reference: run-index contract. :contentReference[oaicite:7]{index=7}

---

## Data Ownership Model
### Authoritative
- **S3 request document**: facts, runs, attempts, locks, approvals, PR refs, merge SHA, etc.
- **Postgres**: index rows (metadata needed for list/filter)

### Derived (never authoritative)
- lifecycle status (derived from facts)
- aggregates/insights derived from facts (optionally cached, never trusted)

---

## Proposed Postgres Tables (Minimum)
### `requests_index`
Purpose: list/filter without scanning S3.

Suggested columns (authoritative metadata only):
- request_id (PK)
- created_at, updated_at
- project_key / repo_full_name
- environment_key (dev/stage/prod)
- module_key / template_key
- actor (creator)
- pr_number (nullable)
- merged_sha (nullable)
- last_run_kind (plan/apply/destroy) (nullable)
- last_run_conclusion (nullable)  (fact)
- last_activity_at (for sorting)
- doc_etag / doc_hash (optional, to detect drift between S3 doc and index row)

⚠️ No authoritative lifecycle status column.

### `audit_events` (optional in this delta, recommended soon)
Append-only audit trail for commands:
- event_id (PK)
- occurred_at
- actor
- action
- resource_type/resource_id
- correlation_id
- before_hash / after_hash (optional)
- metadata jsonb (small)

---

## Read Paths (After Delta)
### Requests list
- Read from Postgres `requests_index`
- For each row, compute derived status by:
  - either fetching the S3 request doc (accurate, more IO)
  - or computing a safe derived status from a minimal set of facts (if and only if those facts are in the index)
Preferred v1: compute derived status on API from the same function used everywhere, using facts from S3 if needed. (Consistency > optimization.)

### Request detail
- Load request doc from S3
- Derive lifecycle status exactly as today

---

## Write Paths (After Delta)
Any route that persists request JSON to S3 must also upsert `requests_index`:
- create request
- dispatch plan/apply/destroy (attempt created)
- webhook patch (attempt facts updated)
- sync / repair patch
- approval / merge / lock updates

The index upsert must be resilient:
- failures to update index must not corrupt the request document
- index can be repaired/rebuilt later (best-effort)

---

## Migration Steps (PR-by-PR)
### PR 1 — Postgres foundation
- Add DB connection + migrations
- Create `requests_index` (+ `audit_events` if included)
- Add health endpoint and local dev docs

### PR 2 — Write-through indexing
- On every request write to S3, upsert `requests_index`
- Keep existing list endpoint reading from S3 (no behavior change yet)

### PR 3 — Switch list endpoint to Postgres
- GET /api/requests reads from Postgres
- Derived status still computed with deriveLifecycleStatus (no stored truth)
- Validate SSE revalidation still works

### PR 4 — Add index repair command (optional)
- backfill index from S3 docs (dev-friendly)

---

## Rollback Plan
Rollback is safe because S3 remains authoritative:
- disable Postgres list reads (feature flag)
- keep writing S3 request documents as before
- Postgres can be dropped/rebuilt without affecting request truth

---

## Future (Out of Scope for This Delta)
- Environment-first UX layer and TTL
- policy gates / OPA integration
- drift scans + cost estimation jobs
- multi-IaC (Terraform-first boundary stays)

Those are separate deltas and must preserve Tier-A invariants. :contentReference[oaicite:8]{index=8}