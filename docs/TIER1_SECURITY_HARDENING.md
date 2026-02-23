TfPilot — Tier 1 Security Baseline
Purpose

This document defines the minimum security baseline for TfPilot API routes and runtime configuration.

It exists to ensure:

Sensitive infrastructure data is never exposed publicly

OpenAI usage cannot be abused

S3 writes are authenticated

Future API routes cannot accidentally ship without auth

Drift workflows remain functional and secure

This is the foundational hardening layer before additional enterprise features.

Security Principles

Default deny — all /api/* routes require authentication unless explicitly exempt.

Single source of truth — session validation is handled via shared helper or middleware.

Least privilege — only endpoints that must be public are public.

Backward compatibility — no changes to request schema, S3 layout, or workflow contracts.

Non-breaking rollout — UI and workflows must continue to function exactly as before.

Auth Model

TfPilot uses cookie-based session auth.

Session validation is performed via:

lib/auth/session.ts

Authenticated routes must verify session before executing any logic.

Unauthenticated access must return:

401 JSON response

No redirects.

Implemented (Tier 1)

**Files changed:** `lib/auth/session.ts`, `app/api/requests/[requestId]/route.ts`, `app/api/infra-assistant/route.ts`, `app/api/chat-logs/route.ts`, `proxy.ts`.

- **requireSession()** in `lib/auth/session.ts`: returns `SessionPayload | NextResponse`; invalid/missing session → 401 JSON, valid → session object.
- **Secured endpoints** (use requireSession at route level):
  - GET `/api/requests/[requestId]`
  - POST `/api/infra-assistant`
  - POST `/api/chat-logs`
- **proxy.ts** (Next.js 16 proxy layer):
  - `/api/*` unauthenticated → **401 JSON** `{ "error": "Unauthorized" }` (no redirect).
  - Non-API unauthenticated → redirect to `/login` (unchanged).

Exemptions (no session required)

- `GET /api/health` — public (ALB/ECS health checks).
- `/api/auth/*` — OAuth; no session required.
- `POST /api/requests/drift-eligible` — webhook; validated by `x-tfpilot-secret`.
- `POST /api/requests/[requestId]/drift-result` — webhook; validated by `x-tfpilot-secret`.

Protected Endpoints (Must Require Session)

The following endpoints MUST always require a valid session:

Requests

GET /api/requests/[requestId]

POST /api/requests

POST /api/requests/update

POST /api/requests/[requestId]/approve

POST /api/requests/[requestId]/apply

POST /api/requests/[requestId]/destroy

POST /api/requests/[requestId]/assistant/state

POST /api/requests/[requestId]/clarifications/respond

GET /api/requests/[requestId]/logs

GET /api/requests/[requestId]/audit-export

GitHub orchestration

/api/github/*

Templates

/api/templates

/api/templates/admin/*

Assistant

POST /api/infra-assistant

Chat logs

POST /api/chat-logs

Public Endpoints (Explicit Allowlist)

These endpoints are intentionally public and must remain accessible without session:

Health
GET /api/health

Used by ALB / ECS health checks.

Secret-Based Endpoints (Webhook Auth Only)

These endpoints must NOT require session but MUST validate:

x-tfpilot-secret
Drift workflows

POST /api/requests/drift-eligible

POST /api/requests/[requestId]/drift-result

Middleware Guardrail

A global guard must exist to prevent future routes from being created without auth.

Behavior

All /api/* routes require session by default unless path matches:

/api/health
/api/auth/*
/api/requests/drift-eligible
/api/requests/*/drift-result

Middleware must return 401 JSON if session missing.

Known Risks Addressed

This baseline explicitly fixes:

Request data exposure risk

Previously request JSON could be fetched without auth.

OpenAI abuse risk

Infra assistant endpoint could be called publicly.

S3 write abuse

Chat logs endpoint could be written to without auth.

Future route drift

New API routes could accidentally be exposed.

Environment Requirements
Required variables
AUTH_SECRET
TFPILOT_WEBHOOK_SECRET
TFPILOT_WEBHOOK_SECRET

Used by drift workflows to authenticate requests.

Sent as header:

x-tfpilot-secret

Must be configured in:

GitHub Actions

Drift workflow caller

Non-Goals (Out of Scope)

This tier does NOT include:

RBAC redesign

Rate limiting

API keys

Audit logging improvements

Encryption changes

IAM changes

S3 bucket policy changes

Test suite implementation

Observability changes

These are handled in later tiers.

Acceptance Criteria

The baseline is complete when:

All sensitive endpoints return 401 when unauthenticated

UI functions normally when logged in

Drift workflows still function with secret

No changes to request lifecycle behavior

No changes to Terraform generation

No changes to S3 structure

Verification

Run (replace host/port if needed; no auth):

```bash
BASE="http://localhost:3000"

# 1) GET request detail (no auth) => 401 JSON
curl -i "$BASE/api/requests/req_dev_s3_gwgsvm"

# 2) POST infra-assistant (no auth) => 401 JSON
curl -i -X POST "$BASE/api/infra-assistant" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"x"}]}'

# 3) POST chat-logs (no auth) => 401 JSON
curl -i -X POST "$BASE/api/chat-logs" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"x"}]}'

# 4) Health => 200 (public)
curl -i "$BASE/api/health"
```

Expected:

- (1)–(3): HTTP 401, body `{ "error": "Unauthorized" }`; no 307 redirect.
- (4): HTTP 200, body `{ "status": "ok" }`.

Manual checklist: request detail logged out → 401; infra assistant without cookie → 401; chat logs without cookie → 401; health → 200; drift webhook with secret → works; logged-in UI loads requests and assistant.

**Build:** `npm run build` passes. Lint reports pre-existing issues elsewhere in the codebase (not introduced by Tier 1).

Future Tiers
Tier 2 — Reliability

Tests

Type tightening

Config unification

Error telemetry

Tier 3 — Enterprise

Rate limiting

Audit improvements

Policy engine

Multi-tenant guardrails

Ownership

Platform Engineering

Any new /api route must comply with this document before merge.

Summary

This baseline ensures TfPilot:

Protects infrastructure data

Prevents abuse

Maintains workflow integrity

Establishes a secure default posture

It is the minimum bar for production operation.

---

Tier 1 Completion Record

- **Date completed:** 2025-02-23
- **Protected endpoints:** GET `/api/requests/[requestId]`, POST `/api/infra-assistant`, POST `/api/chat-logs` (requireSession at route + proxy).
- **Proxy:** `/api/*` unauthenticated → 401 JSON `{ "error": "Unauthorized" }` (no redirect). Non-API → redirect to `/login`.
- **Exemptions:** GET `/api/health`, `/api/auth/*`, `/api/requests/drift-eligible`, `/api/requests/[requestId]/drift-result`.
- **Note:** `npm run build` ✅; `npm run lint` ❌ (pre-existing; not introduced by Tier 1).

Quick checks (runbook)

Copy/paste (set BASE and REQ_ID as needed):

```bash
BASE="http://localhost:3000"
REQ_ID="req_dev_s3_gwgsvm"

# 401 checks (expect 401 + {"error":"Unauthorized"}, no Location)
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/requests/$REQ_ID"
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/infra-assistant" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"x"}]}'
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/chat-logs" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"x"}]}'

# Health (expect 200)
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health"

# Drift with secret (replace YOUR_WEBHOOK_SECRET)
# curl -s -w "%{http_code}" -X POST "$BASE/api/requests/drift-eligible" -H "x-tfpilot-secret: YOUR_WEBHOOK_SECRET"
# curl -s -w "%{http_code}" -X POST "$BASE/api/requests/$REQ_ID/drift-result" -H "x-tfpilot-secret: YOUR_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{}'
```

Next (Tier 2 candidates)

- Tests for auth, request read, and proxy behavior.
- Unify env / workflow config sources.
- Reduce `any` in request and storage types.
- Add basic error telemetry.