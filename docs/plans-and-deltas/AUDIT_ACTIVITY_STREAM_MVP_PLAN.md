# Audit Activity Stream MVP — Implementation Plan

**Status:** Plan only. Do NOT implement yet.  
**Context:** TfPilot internal developer platform for deterministic Terraform delivery.  
**Goal:** MVP audit activity stream for platform mutations.

---

## 1. Recommended Architecture

**Postgres-only append-only audit table.** No S3, no queues, no event buses.

- **Rationale:** Audit records platform mutations (who did what, when). Postgres already holds org/team/project data and the request index. An append-only `audit_events` table fits the projection/query model and keeps the system simple.
- **S3 is not needed:** S3 is authoritative for request documents. Audit is a separate concern—recording mutations, not deriving lifecycle. Lifecycle remains derived from S3 facts only.
- **Write model:** Fire-and-forget at mutation boundaries. Audit writes are **best-effort** (see §9). Failures are logged; they do not block the primary mutation.
- **Read model:** Org-scoped list API; cursor pagination; optional filters.

---

## 2. Storage Model

**New table: `audit_events`**

| Column        | Type         | Description |
|---------------|--------------|-------------|
| `id`          | TEXT PK      | `audit_<nanoid>` or `audit_<uuid>` |
| `org_id`      | TEXT NOT NULL | Org scope; FK to orgs(id) optional for flexibility |
| `actor_login` | TEXT         | GitHub login when user-triggered; NULL when source is system/webhook |
| `source`      | TEXT         | `user` \| `system` \| `github_webhook` — cleaner than encoding in actor_login |
| `event_type`  | TEXT NOT NULL | e.g. `org_created`, `request_approved` |
| `entity_type` | TEXT NOT NULL | e.g. `org`, `team`, `request`, `environment` |
| `entity_id`   | TEXT NOT NULL | ID of the affected entity |
| `created_at`  | TIMESTAMPTZ  | Event timestamp (server-side) |
| `metadata`    | JSONB         | Small structured JSON; optional `request_id`, `environment_id`, `project_key`, etc. |
| `request_id`  | TEXT          | Optional; denormalized for common filter |
| `environment_id` | TEXT       | Optional; denormalized |
| `project_key` | TEXT          | Optional; denormalized |

**Indexes:**
- `(org_id, created_at DESC, id DESC)` — primary query pattern; includes `id` for stable cursor ordering (avoids secondary sort)
- `(org_id, event_type)` — optional filter
- `(request_id)` — optional for request-centric views

**Constraints:** Append-only. No UPDATE or DELETE in normal operation.

---

## 3. Event Schema

**Event types (MVP):**

| event_type             | entity_type | entity_id   | Notes |
|------------------------|-------------|-------------|-------|
| `org_created`          | org         | org.id      | Platform admin |
| `org_archived`        | org         | org.id      | Platform admin |
| `org_restored`        | org         | org.id      | Platform admin |
| `team_created`        | team        | team.id     | Org admin |
| `team_member_added`   | team        | team.id     | metadata: `{ login }` |
| `team_member_removed` | team        | team.id     | metadata: `{ login }` |
| `project_access_granted` | project  | project.id  | metadata: `{ team_id, team_slug }` |
| `project_access_revoked` | project  | project.id  | metadata: `{ team_id, team_slug }` |
| `request_created`     | request     | request.id  | metadata: `{ project_key, environment_id }` |
| `request_approved`    | request     | request.id  | |
| `request_applied`     | request     | request.id  | |
| `request_destroyed`   | request     | request.id  | Infra destroyed |
| `environment_destroy_requested` | environment | env.id | User initiated destroy (who asked); distinct from environment_archived (lifecycle) |
| `environment_deploy_pr_opened` | environment | env.id | Deploy route creates PR |

**Note:** `environment_deployed` (PR merged) has no clear write boundary in MVP—deploy merge happens in GitHub. Defer to future; document as "do not do yet" or add webhook handler for `pull_request` closed when head matches `deploy/<key>/<slug>`.

**Metadata shape (small, structured):**
- `{ login?: string }` — for team_member_* 
- `{ team_id?: string, team_slug?: string }` — for project_access_*
- `{ project_key?: string, environment_id?: string, module?: string }` — for request_created

---

## 4. Write Points / Producers

| Mutation | Route / Location | Actor | When to emit |
|----------|------------------|-------|--------------|
| org_created | POST /api/platform/orgs | session.login | After createOrgWithInitialAdmin succeeds |
| org_archived | POST /api/platform/orgs/[orgId]/archive | session.login | After archiveOrg succeeds; only if state changed (see §9) |
| org_restored | POST /api/platform/orgs/[orgId]/restore | session.login | After restoreOrg succeeds; only if state changed |
| team_created | POST /api/org/teams | session.login | After createTeam succeeds |
| team_member_added | POST /api/org/teams/[teamId]/members | session.login | Only when addTeamMember actually inserts (change fn to return boolean) |
| team_member_removed | DELETE /api/org/teams/[teamId]/members | session.login | Only when removeTeamMember returns true |
| project_access_granted | POST /api/org/teams/access | session.login | Only when grantProjectTeamAccess actually inserts (change fn to return boolean) |
| project_access_revoked | DELETE /api/org/teams/access | session.login | Only when revokeProjectTeamAccess returns true |
| request_created | POST /api/requests | session.login | After saveRequest; **not** on idempotency replay |
| request_approved | POST /api/requests/[id]/approve | session.login | After approval patch; **not** on replay |
| request_applied | POST /api/requests/[id]/apply | session.login | After dispatch patch; **not** on replay |
| request_destroyed | POST /api/requests/[id]/destroy | session.login | After destroy patch; **not** on replay |
| environment_destroy_requested | POST /api/environments/[id]/destroy | session.login | When user initiates destroy (before workflow runs) |
| environment_deploy_pr_opened | POST /api/environments/[id]/deploy | session.login | After createDeployPR succeeds |

**Webhook / system-triggered (best-effort, lower priority for MVP):**
- `environment_archived` (from webhook when destroy workflow completes): `actor_login` NULL, `source` `github_webhook` — consider for Phase 2.

**Central write helper:** `lib/audit/write.ts` — `writeAuditEvent(deps, event)`. Injected into routes or called after mutation. Does not throw; logs on failure.

---

## 5. Read API Design

**Endpoint:** `GET /api/audit` (or `GET /api/org/audit`)

**Auth:** Session required. `requireActiveOrg`. Org-scoped: `session.orgId` only.

**Query params:**
- `limit` — 1–100, default 25
- `cursor` — opaque for next page
- `event_type` — optional filter (single value)
- `entity_type` — optional filter
- `request_id` — optional filter
- `actor_login` — optional filter

**Response:**
```json
{
  "events": [
    {
      "id": "audit_xxx",
      "org_id": "org_xxx",
      "actor_login": "alice",
      "source": "user",
      "event_type": "request_approved",
      "entity_type": "request",
      "entity_id": "req_yyy",
      "created_at": "2026-03-07T12:00:00Z",
      "metadata": {},
      "request_id": "req_yyy",
      "environment_id": null,
      "project_key": "payments"
    }
  ],
  "next_cursor": "base64..."
}
```

**Ordering:** `created_at DESC`, `id DESC` (stable tie-break).

**RBAC:** Org members with at least viewer role can read. Org admin or platform admin for full visibility. No separate audit-read role in MVP.

---

## 6. UI Surface Recommendation

**Location:** `/settings/audit` or `/org/audit` (org-scoped).

**Layout:** Simple feed/list:
- Column: timestamp, actor, event type (human-readable), entity link (e.g. request → `/requests/[id]`), optional metadata snippet.
- Filters: event type dropdown, date range (optional), actor (optional).
- Pagination: "Load more" or cursor-based infinite scroll.

**Reference:** Similar to environment activity (`/environments/[id]` activity tab) but org-wide. Reuse existing list/feed patterns from `app/requests/page.tsx` and `lib/environments/activity.ts`.

**Access:** Org members (viewer+). Consider org-admin-only for MVP if desired; recommend viewer+ for transparency.

---

## 7. RBAC / Access Model

| Role | Read audit | Write audit |
|------|------------|-------------|
| Platform admin | All orgs (future) | N/A (system writes) |
| Org admin | Own org | N/A |
| Org member (viewer+) | Own org | N/A |

**Write:** Only the system writes audit events. No user-initiated audit write.

**Read:** Org-scoped. Caller must have `session.orgId` and pass `requireActiveOrg`. No cross-org audit in MVP. Platform admin viewing another org's audit: future (separate endpoint or `?orgId=` with platform check).

---

## 8. Pagination / Filtering Approach

**Cursor:** Base64url-encoded `{ created_at, id }`. Same pattern as `requestsList.ts` `encodeCursor` / `decodeCursor`.

**Query:** `WHERE org_id = $1 [AND event_type = $2] [AND entity_type = $3] [AND request_id = $4] [AND actor_login = $5] ORDER BY created_at DESC, id DESC LIMIT $n`. Cursor: `(created_at, id) < (cursor_ts, cursor_id)`.

**Index:** `(org_id, created_at DESC, id DESC)` covers primary query. Partial indexes for filters if needed later.

---

## 9. Determinism + Idempotency Considerations

### Duplicate prevention

1. **Request routes with idempotency keys (create, approve, apply, destroy):**
   - On **replay** (same key, within window): return stored response **without** performing mutation. **Do not** call `writeAuditEvent`. Audit only when mutation actually occurs.
   - Implementation: Call `writeAuditEvent` only in the "recorded" or "new" path, never in the "replay" path.

2. **Idempotent DB operations (grant, add, archive, restore):**
   - `grantProjectTeamAccess`: `ON CONFLICT DO NOTHING` — no row inserted on duplicate. **Change** to return `boolean` (inserted or not). Emit only when `true`.
   - `addTeamMember`: Same. Return `boolean`; emit only when inserted.
   - `revokeProjectTeamAccess`: Already returns `boolean`. Emit only when `true`.
   - `removeTeamMember`: Already returns `boolean`. Emit only when `true`.
   - `archiveOrg` / `restoreOrg`: Currently always return ok. **Option A:** Emit every time (duplicates on retry). **Option B:** Change to return `{ ok, changed }` using `WHERE archived_at IS NULL` (archive) or `WHERE archived_at IS NOT NULL` (restore); emit only when `changed`. **Recommend Option B** for consistency.

### Best-effort vs transactional

- **Best-effort:** Audit write is **not** in the same transaction as the mutation. Rationale: Audit must not block core flows. If audit insert fails, log and continue. Index write (requests_index) already follows this pattern.
- **Ordering:** Events are ordered by `created_at` (server clock). No strict ordering guarantee across concurrent requests; acceptable for admin/debug visibility.

### Actor attribution rules

| Source | actor_login | source |
|--------|-------------|--------|
| User-initiated (session) | `session.login` | `user` |
| Webhook (no user) | `NULL` | `github_webhook` |
| Background job / cron | `NULL` | `system` |

Using a dedicated `source` column keeps actor semantics clean: `actor_login` is only set for user actions; system/webhook events use `source` instead of encoding in actor_login.

---

## 10. Risks / Edge Cases

| Risk | Mitigation |
|------|------------|
| Audit write failure blocks mutation | Best-effort; catch, log, continue. Never throw from writeAuditEvent into route. |
| Duplicate events on retry | Idempotency-key replay: no audit. Idempotent DB ops: only emit when state changed. |
| Org_id missing for platform events | org_created: org_id from new org. archive/restore: org_id from params. |
| High volume | MVP: no retention policy. Later: partition by month or archive old rows. |
| Webhook event ordering | Best-effort. Accept eventual consistency. |
| Actor spoofing | Actor comes from server-side session only. Never from client. |

---

## 11. Step-by-Step Implementation Phases

### Phase 1 — Foundation (first slice)
1. Migration: create `audit_events` table + indexes.
2. `lib/audit/write.ts`: `writeAuditEvent(deps, event)` — non-throwing, logs on failure.
3. `lib/audit/types.ts`: Export `AuditEventType` (const array or union) and payload types — prevents typos across routes.
4. Wire **3 events** only: `org_created`, `org_archived`, `org_restored` (platform routes). Validate end-to-end.
5. `GET /api/audit`: org-scoped list, cursor pagination, no filters.
6. Minimal UI: `/settings/audit` or `/settings/platform/audit` — list events for current org.

**First slice deliverable:** Platform org lifecycle events visible in audit feed.

### Phase 2 — Teams and project access
1. Change `grantProjectTeamAccess`, `addTeamMember` to return `boolean` (inserted or not).
2. Wire `team_created`, `team_member_added`, `team_member_removed`, `project_access_granted`, `project_access_revoked`.
3. Change `archiveOrg`/`restoreOrg` to return `changed`; emit only when changed.
4. Add filters: `event_type`, `entity_type` to API.

### Phase 3 — Request lifecycle
1. Wire `request_created` (guard: not on replay).
2. Wire `request_approved`, `request_applied`, `request_destroyed` (guard: not on replay).
3. Wire `environment_deploy_pr_opened` from deploy route.
4. Wire `environment_destroy_requested` from environment destroy route.
5. Add `request_id`, `actor_login` filters to API.
6. Polish UI: entity links, human-readable labels.

### Phase 4 — Optional
- `environment_deployed` from webhook (pull_request closed, deploy branch merged).
- `environment_archived` from webhook.
- Platform admin: view audit for any org.

---

## 12. Testing Plan

| Area | Approach |
|------|----------|
| Unit | `writeAuditEvent` — mock DB; assert insert called with correct shape; assert no throw on DB error. |
| Unit | Idempotency: request create replay path does NOT call writeAuditEvent. |
| Unit | grantProjectTeamAccess/addTeamMember return value; emit only when true. |
| API | GET /api/audit: 401 when no session; 403 when org archived; 200 with events; cursor pagination; filters. |
| API | Org scope: events from other orgs not returned. |
| Invariant | Add to invariant suite: audit write is best-effort (does not block mutation). |
| E2E | Create org → audit event appears. Archive org → event appears. |

---

## 13. Explicit "Do Not Do Yet" List

- **Kafka, SNS, SQS, event buses** — Not in scope.
- **S3 for audit** — Postgres is sufficient.
- **Compliance export / SIEM integration** — Out of MVP.
- **Audit as source of truth for lifecycle** — Audit records mutations; lifecycle remains derived from S3 facts.
- **Second request lifecycle store** — Do not duplicate request state in audit; use request_id as pointer.
- **Retention / archival policy** — Defer.
- **Real-time audit stream (SSE/WebSocket)** — Defer.
- **environment_deployed from deploy route** — Deploy route opens PR; "deployed" = PR merged. Defer until webhook handler exists.
- **Cross-org audit for platform admin** — Phase 4.
- **Audit event schema versioning / migration of old events** — MVP uses single schema; document for future.

---

## Recommended First Slice

**Build in Phase 1:**
- `audit_events` table
- `writeAuditEvent` helper
- `org_created`, `org_archived`, `org_restored` write points
- `GET /api/audit` (org-scoped, cursor)
- Basic `/settings/audit` UI

**Validate:** Create org, archive, restore → three events in feed. Cursor pagination works.
