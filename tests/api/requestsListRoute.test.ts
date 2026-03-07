/**
 * API route tests: GET /api/requests list handler.
 * Uses makeRequestsGET() with injected mocks; no real DB, S3, or auth.
 */

import { NextRequest } from "next/server"
import {
  makeRequestsGET,
  type RequestsListRouteDeps,
} from "@/app/api/requests/route"
import { encodeCursor, decodeCursor } from "@/lib/db/requestsList"
import { computeDocHash } from "@/lib/db/indexer"
import type { RequestIndexRow } from "@/lib/db/requestsList"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function listRequest(url = "http://localhost/api/requests?limit=10"): NextRequest {
  return new NextRequest(url, { method: "GET" })
}

const mockSession = { login: "test", name: "Test", avatarUrl: null, orgId: "org_default" }

function defaultDeps(overrides: Partial<RequestsListRouteDeps> = {}): RequestsListRouteDeps {
  const indexRows: RequestIndexRow[] = [
    {
      request_id: "req_1",
      updated_at: "2026-01-15T12:00:00.000Z",
      last_activity_at: "2026-01-15T12:00:00.000Z",
      doc_hash: "abc123",
    },
  ]
  const doc1 = {
    id: "req_1",
    org_id: "org_default",
    receivedAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    project_key: "core",
    environment_key: "dev",
    environment_slug: "ai-agent",
    environment_id: "env_1",
    module: "ec2-instance",
    config: {},
  }
  return {
    requireSession: async () => mockSession,
    requireActiveOrg: async () => null,
    listRequestIndexRowsPage: async () => indexRows,
    getRequest: async (id) => (id === "req_1" ? doc1 : {}),
    computeDocHash: (d) => computeDocHash(d as Parameters<typeof computeDocHash>[0]),
    deriveLifecycleStatus: () => "plan_ready",
    encodeCursor,
    decodeCursor,
    MAX_LIST_LIMIT: 200,
    ...overrides,
  }
}

async function callList(deps: RequestsListRouteDeps, req: NextRequest): Promise<Response> {
  const GET = makeRequestsGET(deps)
  const res = await GET(req)
  return res as unknown as Response
}

export const tests = [
  {
    name: "GET /api/requests: happy path returns requests from index",
    fn: async () => {
      const deps = defaultDeps()
      const res = await callList(deps, listRequest())
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.success === true, "success true")
      assert(Array.isArray(body.requests), "requests is array")
      assert(body.requests.length === 1, `expected 1 request, got ${body.requests.length}`)
      const r = body.requests[0]
      assert(r.id === "req_1", "request id")
      assert(r.status === "plan_ready", "derived status")
      assert(r.index_projection_updated_at === "2026-01-15T12:00:00.000Z", "index_projection_updated_at")
      assert(Array.isArray(body.list_errors), "list_errors is array")
      assert(body.list_errors.length === 0, "no list_errors")
    },
  },
  {
    name: "GET /api/requests: response includes next_cursor when more pages exist",
    fn: async () => {
      const twoRows: RequestIndexRow[] = [
        { request_id: "req_1", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: "2026-01-15T12:00:00.000Z", doc_hash: "h1" },
        { request_id: "req_2", updated_at: "2026-01-15T11:00:00.000Z", last_activity_at: "2026-01-15T11:00:00.000Z", doc_hash: "h2" },
      ]
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => twoRows,
        getRequest: async (id) => ({
          id,
          org_id: "org_default",
          receivedAt: "2026-01-15T10:00:00.000Z",
          updatedAt: id === "req_1" ? "2026-01-15T12:00:00.000Z" : "2026-01-15T11:00:00.000Z",
          project_key: "core",
          environment_key: "dev",
          environment_slug: "ai-agent",
          environment_id: "env_1",
          module: "ec2-instance",
          config: {},
        }),
      })
      const res = await callList(deps, listRequest("http://localhost/api/requests?limit=1"))
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.next_cursor != null, `expected next_cursor, got ${body.next_cursor}`)
      assert(body.requests.length === 1, "one request on page")
    },
  },
  {
    name: "GET /api/requests: no next_cursor when final page",
    fn: async () => {
      const oneRow: RequestIndexRow[] = [
        { request_id: "req_1", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: "2026-01-15T12:00:00.000Z", doc_hash: "h1" },
      ]
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => oneRow,
      })
      const res = await callList(deps, listRequest("http://localhost/api/requests?limit=10"))
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.next_cursor === null, `expected null next_cursor, got ${body.next_cursor}`)
    },
  },
  {
    name: "GET /api/requests: invalid cursor returns 400, listRequestIndexRowsPage not called",
    fn: async () => {
      let listCalled = false
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => {
          listCalled = true
          return []
        },
      })
      const res = await callList(deps, listRequest("http://localhost/api/requests?cursor=invalid!!!cursor"))
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Invalid or malformed cursor", `expected error, got ${body.error}`)
      assert(!listCalled, "listRequestIndexRowsPage must NOT be called on invalid cursor")
    },
  },
  {
    name: "GET /api/requests: DB unconfigured (null) returns 503",
    fn: async () => {
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => null,
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 503, `expected 503, got ${res.status}`)
      const body = await res.json()
      assert(
        body.error?.includes("Database not configured") || body.error?.includes("Postgres"),
        `expected DB error, got ${body.error}`
      )
    },
  },
  {
    name: "GET /api/requests: DB throws returns 503",
    fn: async () => {
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => {
          throw new Error("Connection refused")
        },
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 503, `expected 503, got ${res.status}`)
      const body = await res.json()
      assert(body.error?.includes("Database unreachable"), `expected unreachable, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests: NoSuchKey omits request from list, adds to list_errors, no 500",
    fn: async () => {
      const rows: RequestIndexRow[] = [
        { request_id: "req_missing", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: null, doc_hash: "h1" },
      ]
      const noSuchKey = Object.assign(new Error("The specified key does not exist"), { name: "NoSuchKey" })
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => rows,
        getRequest: async () => {
          throw noSuchKey
        },
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 200, `expected 200 (tolerate missing doc), got ${res.status}`)
      const body = await res.json()
      assert(body.requests.length === 0, "missing doc omitted from requests")
      assert(body.list_errors.length === 1, `expected 1 list_error, got ${body.list_errors.length}`)
      assert(body.list_errors[0].request_id === "req_missing", "list_error has request_id")
      assert(body.list_errors[0].error === "NoSuchKey", "list_error is NoSuchKey")
    },
  },
  {
    name: "GET /api/requests: non-NoSuchKey fetch failure returns 500, not list_errors",
    fn: async () => {
      const rows: RequestIndexRow[] = [
        { request_id: "req_bad", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: null, doc_hash: "h1" },
      ]
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => rows,
        getRequest: async () => {
          throw new Error("S3 GetObject failed: AccessDenied")
        },
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 500, `expected 500 on non-NoSuchKey fetch failure, got ${res.status}`)
      const body = await res.json()
      assert(body.success === false, "success false")
      assert(body.error != null, "error message present")
      assert(!Array.isArray(body.list_errors) || body.list_errors.length === 0, "list_errors not populated for non-NoSuchKey failure")
    },
  },
  {
    name: "GET /api/requests: index_drift true when S3 doc hash differs from indexed doc_hash",
    fn: async () => {
      const docHashFromS3 = computeDocHash({
        id: "req_1",
        org_id: "org_default",
        receivedAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
        environment_id: "env_1",
        module: "ec2-instance",
        config: {},
      })
      const rows: RequestIndexRow[] = [
        { request_id: "req_1", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: null, doc_hash: "stale_index_hash" },
      ]
      const doc = {
        id: "req_1",
        org_id: "org_default",
        receivedAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
        environment_id: "env_1",
        module: "ec2-instance",
        config: {},
      }
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => rows,
        getRequest: async () => doc,
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.requests.length === 1, "one request")
      const r = body.requests[0]
      assert(r.index_drift === true, "index_drift true when hash differs")
      assert(r.index_doc_hash === "stale_index_hash", "index_doc_hash from row")
      assert(r.s3_doc_hash === docHashFromS3, "s3_doc_hash from computeDocHash")
    },
  },
  {
    name: "GET /api/requests: index_drift absent when hashes match",
    fn: async () => {
      const doc = {
        id: "req_1",
        org_id: "org_default",
        receivedAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
        project_key: "core",
        environment_key: "dev",
        environment_slug: "ai-agent",
        environment_id: "env_1",
        module: "ec2-instance",
        config: {},
      }
      const correctHash = computeDocHash(doc as Parameters<typeof computeDocHash>[0])
      const rows: RequestIndexRow[] = [
        { request_id: "req_1", updated_at: "2026-01-15T12:00:00.000Z", last_activity_at: null, doc_hash: correctHash },
      ]
      const deps = defaultDeps({
        listRequestIndexRowsPage: async () => rows,
        getRequest: async () => doc,
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      const r = body.requests[0]
      assert(r.index_drift !== true, "index_drift not true when hashes match")
      assert(r.index_doc_hash === undefined, "index_doc_hash absent when no drift")
    },
  },
  {
    name: "GET /api/requests: unauthenticated returns 401",
    fn: async () => {
      const { NextResponse } = await import("next/server")
      const deps = defaultDeps({
        requireSession: async () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "GET /api/requests: no org context returns 403",
    fn: async () => {
      const deps = defaultDeps({
        requireSession: async () => ({ ...mockSession, orgId: undefined }),
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "No org context", `expected error, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests: archived org returns 403",
    fn: async () => {
      const { NextResponse } = await import("next/server")
      const deps = defaultDeps({
        requireActiveOrg: async () => NextResponse.json({ error: "Organization archived" }, { status: 403 }),
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Organization archived", `expected error, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests: archived org returns 403",
    fn: async () => {
      const { NextResponse } = await import("next/server")
      const deps = defaultDeps({
        requireActiveOrg: async () => NextResponse.json({ error: "Organization archived" }, { status: 403 }),
      })
      const res = await callList(deps, listRequest())
      assert(res.status === 403, `expected 403, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Organization archived", `expected archived error, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests: limit clamped to MAX_LIST_LIMIT",
    fn: async () => {
      let capturedLimit = 0
      const deps = defaultDeps({
        MAX_LIST_LIMIT: 200,
        listRequestIndexRowsPage: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      })
      await callList(deps, listRequest("http://localhost/api/requests?limit=9999"))
      assert(capturedLimit === 201, `limit+1 should be 201 (clamped), got ${capturedLimit}`)
    },
  },
  {
    name: "GET /api/requests: limit default 50 when missing",
    fn: async () => {
      let capturedLimit = 0
      const deps = defaultDeps({
        listRequestIndexRowsPage: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      })
      await callList(deps, listRequest("http://localhost/api/requests"))
      assert(capturedLimit === 51, `limit+1 default 51, got ${capturedLimit}`)
    },
  },
  {
    name: "GET /api/requests: valid cursor passed to listRequestIndexRowsPage",
    fn: async () => {
      const validCursor = encodeCursor({ sort_key: "2026-01-15T12:00:00.000Z", request_id: "req_1" })
      let capturedCursor: string | null = null
      const deps = defaultDeps({
        listRequestIndexRowsPage: async (opts) => {
          capturedCursor = opts.cursor
          return []
        },
      })
      await callList(deps, listRequest(`http://localhost/api/requests?cursor=${validCursor}`))
      assert(capturedCursor === validCursor, `cursor passed through, got ${capturedCursor}`)
    },
  },
]
