/**
 * API route tests: GET /api/audit.
 * Uses makeAuditGET() with injected mocks; no real DB or auth.
 */

import { NextRequest, NextResponse } from "next/server"
import { makeAuditGET, type AuditRouteDeps } from "@/app/api/audit/route"
import {
  decodeAuditCursor,
  encodeAuditCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type AuditEventRow,
} from "@/lib/db/auditList"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockSession = { login: "test", name: "Test", avatarUrl: null, orgId: "org_default" }

function defaultDeps(overrides: Partial<AuditRouteDeps> = {}): AuditRouteDeps {
  const events: AuditEventRow[] = [
    {
      id: "audit_1",
      org_id: "org_default",
      actor_login: "alice",
      source: "user",
      event_type: "team_created",
      entity_type: "team",
      entity_id: "team_1",
      created_at: "2026-03-07T12:00:00.000Z",
      metadata: { team_slug: "eng", name: "Engineering" },
      request_id: null,
      environment_id: null,
      project_key: null,
    },
  ]
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    listAuditEvents: async ({ orgId, limit, cursor }) => {
      const all = events.filter((e) => e.org_id === orgId)
      const sorted = [...all].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          b.id.localeCompare(a.id)
      )
      let start = 0
      if (cursor) {
        const decoded = decodeAuditCursor(cursor)
        if (!decoded) return null
        const idx = sorted.findIndex((e) => e.created_at === decoded.created_at && e.id === decoded.id)
        if (idx < 0) return { events: [], nextCursor: null }
        start = idx + 1
      }
      const page = sorted.slice(start, start + limit)
      const hasMore = sorted.length > start + limit
      const last = page[page.length - 1]
      const nextCursor =
        hasMore && last ? encodeAuditCursor({ created_at: last.created_at, id: last.id }) : null
      return { events: page, nextCursor }
    },
    decodeAuditCursor,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    ...overrides,
  }
}

async function callAudit(deps: AuditRouteDeps, url = "http://localhost/api/audit"): Promise<Response> {
  const GET = makeAuditGET(deps)
  const req = new NextRequest(url, { method: "GET" })
  const res = await GET(req)
  return res as unknown as Response
}

export const tests = [
  {
    name: "GET /api/audit: unauthenticated returns 401",
    fn: async () => {
      const deps = defaultDeps({ getSessionFromCookies: async () => null })
      const res = await callAudit(deps)
      assert(res.status === 401, `expected 401, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not authenticated", `expected Not authenticated, got ${body.error}`)
    },
  },
  {
    name: "GET /api/audit: missing org context returns 403",
    fn: async () => {
      const deps = defaultDeps({
        getSessionFromCookies: async () => ({ ...mockSession, orgId: undefined }),
      })
      const res = await callAudit(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "No org context", `expected No org context, got ${body.error}`)
    },
  },
  {
    name: "GET /api/audit: archived org denied returns 403",
    fn: async () => {
      const deps = defaultDeps({
        requireActiveOrg: async () => NextResponse.json({ error: "Org archived" }, { status: 403 }),
      })
      const res = await callAudit(deps)
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "GET /api/audit: returns events only for current org",
    fn: async () => {
      const orgA = [
        { id: "a1", org_id: "org_a", actor_login: "u1", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t1", created_at: "2026-03-07T12:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
      ]
      const deps = defaultDeps({
        getSessionFromCookies: async () => ({ ...mockSession, orgId: "org_a" }),
        listAuditEvents: async ({ orgId }) => ({
          events: orgA.filter((e) => e.org_id === orgId),
          nextCursor: null,
        }),
      })
      const res = await callAudit(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.events.length === 1, `expected 1 event, got ${body.events.length}`)
      assert(body.events[0].org_id === "org_a", `expected org_a, got ${body.events[0].org_id}`)
    },
  },
  {
    name: "GET /api/audit: stable ordering created_at DESC id DESC",
    fn: async () => {
      const rows: AuditEventRow[] = [
        { id: "audit_b", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t1", created_at: "2026-03-07T12:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
        { id: "audit_a", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t2", created_at: "2026-03-07T12:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
      ]
      const deps = defaultDeps({
        listAuditEvents: async () => ({
          events: rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id.localeCompare(a.id)),
          nextCursor: null,
        }),
      })
      const res = await callAudit(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.events[0].id === "audit_b", `expected audit_b first (same ts, id DESC), got ${body.events[0].id}`)
    },
  },
  {
    name: "GET /api/audit: returns next_cursor when more rows exist",
    fn: async () => {
      const three: AuditEventRow[] = [
        { id: "a1", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t1", created_at: "2026-03-07T12:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
        { id: "a2", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t2", created_at: "2026-03-07T11:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
        { id: "a3", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t3", created_at: "2026-03-07T10:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
      ]
      const deps = defaultDeps({
        listAuditEvents: async ({ limit }) => {
          const events = three.slice(0, limit)
          const hasMore = three.length > limit
          const last = events[events.length - 1]
          const nextCursor = hasMore && last ? encodeAuditCursor({ created_at: last.created_at, id: last.id }) : null
          return { events, nextCursor }
        },
      })
      const res = await callAudit(deps, "http://localhost/api/audit?limit=2")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.next_cursor != null, `expected next_cursor, got ${body.next_cursor}`)
      assert(body.events.length === 2, `expected 2 events, got ${body.events.length}`)
    },
  },
  {
    name: "GET /api/audit: no next_cursor on final page",
    fn: async () => {
      const one: AuditEventRow[] = [
        { id: "a1", org_id: "org_default", actor_login: "u", source: "user", event_type: "team_created", entity_type: "team", entity_id: "t1", created_at: "2026-03-07T12:00:00.000Z", metadata: null, request_id: null, environment_id: null, project_key: null },
      ]
      const deps = defaultDeps({
        listAuditEvents: async () => ({ events: one, nextCursor: null }),
      })
      const res = await callAudit(deps)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.next_cursor == null, `expected null next_cursor, got ${body.next_cursor}`)
    },
  },
  {
    name: "GET /api/audit: invalid cursor returns 400",
    fn: async () => {
      const deps = defaultDeps({
        decodeAuditCursor: () => null,
      })
      const res = await callAudit(deps, "http://localhost/api/audit?cursor=invalid")
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Invalid or malformed cursor", `expected Invalid or malformed cursor, got ${body.error}`)
    },
  },
  {
    name: "GET /api/audit: DB unavailable returns 503",
    fn: async () => {
      const deps = defaultDeps({
        listAuditEvents: async () => null,
      })
      const res = await callAudit(deps)
      assert(res.status === 503, `expected 503, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Database not configured or unavailable", `expected DB error, got ${body.error}`)
    },
  },
  {
    name: "GET /api/audit: default limit 25",
    fn: async () => {
      let capturedLimit = 0
      const deps = defaultDeps({
        listAuditEvents: async ({ limit }) => {
          capturedLimit = limit
          return { events: [], nextCursor: null }
        },
      })
      await callAudit(deps, "http://localhost/api/audit")
      assert(capturedLimit === 25, `expected limit 25, got ${capturedLimit}`)
    },
  },
  {
    name: "GET /api/audit: limit clamped to max 100",
    fn: async () => {
      let capturedLimit = 0
      const deps = defaultDeps({
        listAuditEvents: async ({ limit }) => {
          capturedLimit = limit
          return { events: [], nextCursor: null }
        },
      })
      await callAudit(deps, "http://localhost/api/audit?limit=999")
      assert(capturedLimit === 100, `expected limit 100, got ${capturedLimit}`)
    },
  },
]
