/**
 * API route tests: GET /api/requests/[requestId]/sync.
 * Uses makeSyncGET() with injected mocks; no real DB, S3, GitHub, or auth.
 */

import { NextRequest } from "next/server"
import { makeSyncGET, type SyncRouteDeps } from "@/app/api/requests/[requestId]/sync/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function syncRequest(requestId: string, opts?: { repair?: string; hydrate?: string }): NextRequest {
  const params = new URLSearchParams()
  if (opts?.repair) params.set("repair", opts.repair)
  if (opts?.hydrate) params.set("hydrate", opts.hydrate)
  const qs = params.toString()
  const url = `http://localhost/api/requests/${requestId}/sync${qs ? `?${qs}` : ""}`
  return new NextRequest(url, { method: "GET" })
}

const mockSession = { login: "test", name: "Test", avatarUrl: null, orgId: "org_default" }

/** Minimal request that yields doGitHub=false (tfpilot-only path): no pr, no branchName, no mergedSha, no active/reconcile attempts. */
function minimalRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "req_sync_1",
    org_id: "org_default",
    receivedAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    project_key: "core",
    workspace_key: "dev",
    workspace_slug: "ai-agent",
    workspace_id: "ws_1",
    module: "ec2-instance",
    config: {},
    runs: {
      plan: { currentAttempt: 0, attempts: [] },
      apply: { currentAttempt: 0, attempts: [] },
      destroy: { currentAttempt: 0, attempts: [] },
    },
    ...overrides,
  }
}

function defaultDeps(overrides: Partial<SyncRouteDeps> = {}): SyncRouteDeps {
  const store = new Map<string, Record<string, unknown>>()
  store.set("req_sync_1", minimalRequest())
  const getReq = async (id: string) => store.get(id) ?? null
  const getOrg = async (id: string) =>
    store.get(id) ? (store.get(id) as { org_id?: string }).org_id ?? null : null
  const doUpdate = async (
    requestId: string,
    mutate: (c: Record<string, unknown>) => Record<string, unknown>
  ): Promise<[Record<string, unknown>, boolean]> => {
    const current = await getReq(requestId)
    if (!current) throw new Error("Request not found")
    const next = mutate(current as Record<string, unknown>)
    if (next === current) return [current as Record<string, unknown>, false]
    store.set(requestId, next)
    return [next, true]
  }
  return {
    requireSession: async () => mockSession,
    requireActiveOrg: async () => null,
    getRequest: getReq,
    getRequestOrgId: getOrg,
    updateRequest: doUpdate,
    ...overrides,
  }
}

async function callSync(
  deps: SyncRouteDeps,
  requestId: string,
  opts?: { repair?: string; hydrate?: string }
): Promise<Response> {
  const GET = makeSyncGET(deps)
  const req = syncRequest(requestId, opts)
  const res = await GET(req, { params: Promise.resolve({ requestId }) })
  return res as unknown as Response
}

export const tests = [
  {
    name: "GET /api/requests/[id]/sync: happy path tfpilot-only returns request with derived status",
    fn: async () => {
      const deps = defaultDeps()
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.success === true, "success true")
      assert(body.request != null, "request present")
      assert(typeof body.request.status === "string", "status is derived (string)")
      assert(body.sync?.mode === "tfpilot-only", `expected tfpilot-only, got ${body.sync?.mode}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: unauthenticated returns 401",
    fn: async () => {
      const { NextResponse } = await import("next/server")
      const deps = defaultDeps({
        requireSession: async () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 401, `expected 401, got ${res.status}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: no org context returns 404",
    fn: async () => {
      const deps = defaultDeps({
        requireSession: async () => ({ ...mockSession, orgId: undefined }),
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 404, `expected 404, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not found", `expected Not found, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: archived org returns 403",
    fn: async () => {
      const { NextResponse } = await import("next/server")
      const deps = defaultDeps({
        requireActiveOrg: async () =>
          NextResponse.json({ error: "Organization archived" }, { status: 403 }),
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 403, `expected 403, got ${res.status}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: request not found returns 404",
    fn: async () => {
      const deps = defaultDeps({
        getRequest: async () => null,
        getRequestOrgId: async () => null,
      })
      const res = await callSync(deps, "req_nonexistent")
      assert(res.status === 404, `expected 404, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Request not found", `expected Request not found, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: cross-org returns 404",
    fn: async () => {
      const deps = defaultDeps({
        getRequest: async () => minimalRequest({ org_id: "other_org" }),
        getRequestOrgId: async () => "other_org",
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 404, `expected 404 for cross-org, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "Not found", `expected Not found, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: needsReconcile false yields tfpilot-only (no GitHub path)",
    fn: async () => {
      let getTokenCalled = false
      const deps = defaultDeps({
        getGitHubAccessToken: async () => {
          getTokenCalled = true
          throw new Error("getToken should not be called when doGitHub=false")
        },
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.sync?.mode === "tfpilot-only", "tfpilot-only when no repair/hydrate and no needsReconcile")
      assert(!getTokenCalled, "getGitHubAccessToken must not be called when reconcile/repair path is skipped")
    },
  },
  {
    name: "GET /api/requests/[id]/sync: repair=1 with no token returns 401",
    fn: async () => {
      const store = new Map<string, Record<string, unknown>>()
      store.set("req_repair", minimalRequest({ targetOwner: "o", targetRepo: "r" }))
      const deps = defaultDeps({
        getRequest: async (id) => store.get(id) ?? null,
        getRequestOrgId: async (id) => (store.get(id) as { org_id?: string })?.org_id ?? null,
      })
      const res = await callSync(deps, "req_repair", { repair: "1" })
      assert(res.status === 401, `expected 401 when repair=1 and no GitHub token, got ${res.status}`)
      const body = await res.json()
      assert(body.error === "GitHub not connected", `expected GitHub error, got ${body.error}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: derived status overrides stored status",
    fn: async () => {
      const req = minimalRequest({ status: "stale_stored_status" })
      const deps = defaultDeps({
        getRequest: async () => req,
        getRequestOrgId: async () => "org_default",
      })
      const res = await callSync(deps, "req_sync_1")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.request.status !== "stale_stored_status", "response status must be derived, not stored")
      assert(typeof body.request.status === "string", "derived status present")
    },
  },
  {
    name: "GET /api/requests/[id]/sync: repair=1 and needsReconcile=true calls reconcile path and returns derived status",
    fn: async () => {
      const store = new Map<string, Record<string, unknown>>()
      const reqReconcile = minimalRequest({
        targetOwner: "o",
        targetRepo: "r",
        runs: {
          plan: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
          apply: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 222, status: "in_progress", dispatchedAt: "2026-01-01T00:00:00Z" }] },
          destroy: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
        },
      })
      store.set("req_reconcile", reqReconcile)
      const reconcileRunPaths: string[] = []
      const doUpdateRequest = async (requestId: string, mutate: (c: Record<string, unknown>) => Record<string, unknown>) => {
        const current = store.get(requestId) as Record<string, unknown>
        if (!current) throw new Error("Request not found")
        const next = mutate(current)
        store.set(requestId, next)
        return [next, true] as [Record<string, unknown>, boolean]
      }
      const deps = defaultDeps({
        getRequest: async (id) => store.get(id) ?? null,
        getRequestOrgId: async (id) => (store.get(id) as { org_id?: string })?.org_id ?? "org_default",
        getGitHubAccessToken: async () => "fake-token",
        githubRequest: (async (opts: { path: string; [k: string]: unknown }) => {
          if (opts.path.includes("/actions/runs/") && !opts.path.includes("/workflows/")) {
            reconcileRunPaths.push(opts.path)
            return { status: "completed", conclusion: "success", completed_at: "2026-01-01T00:05:00Z", updated_at: "2026-01-01T00:05:00Z" }
          }
          if (opts.path.includes("/pulls/") && !opts.path.includes("/reviews")) return { number: 1, html_url: "https://x", state: "closed", merged: true }
          if (opts.path.includes("/reviews")) return []
          if (opts.path.includes("workflow_runs") || opts.path.includes("workflows/")) return { workflow_runs: [] }
          return {}
        }) as NonNullable<SyncRouteDeps["githubRequest"]>,
        updateRequest: doUpdateRequest,
      })
      const res = await callSync(deps, "req_reconcile", { repair: "1" })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.sync?.mode === "repair", "repair mode when repair=1 and needsReconcile")
      assert(typeof body.request.status === "string", "derived status present")
      assert(reconcileRunPaths.length >= 1, `reconcile run fetch must be called at least once, got ${reconcileRunPaths.length}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: repair=1 and needsReconcile=false does not call reconcile run fetch",
    fn: async () => {
      const store = new Map<string, Record<string, unknown>>()
      const reqNoReconcile = minimalRequest({
        targetOwner: "o",
        targetRepo: "r",
        runs: {
          plan: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
          apply: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 2, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
          destroy: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
        },
      })
      store.set("req_noreconcile", reqNoReconcile)
      const reconcileRunPaths: string[] = []
      const doUpdateRequest = async (requestId: string, mutate: (c: Record<string, unknown>) => Record<string, unknown>) => {
        const current = store.get(requestId) as Record<string, unknown>
        if (!current) throw new Error("Request not found")
        const next = mutate(current)
        store.set(requestId, next)
        return [next, true] as [Record<string, unknown>, boolean]
      }
      const deps = defaultDeps({
        getRequest: async (id) => store.get(id) ?? null,
        getRequestOrgId: async (id) => (store.get(id) as { org_id?: string })?.org_id ?? "org_default",
        getGitHubAccessToken: async () => "fake-token",
        githubRequest: (async (opts: { path: string; [k: string]: unknown }) => {
          if (opts.path.includes("/actions/runs/") && !opts.path.includes("/workflows/")) {
            reconcileRunPaths.push(opts.path)
          }
          if (opts.path.includes("/pulls/") && !opts.path.includes("/reviews")) return { number: 1, html_url: "https://x", state: "closed", merged: true }
          if (opts.path.includes("/reviews")) return []
          if (opts.path.includes("workflow_runs") || opts.path.includes("workflows/")) return { workflow_runs: [] }
          return {}
        }) as NonNullable<SyncRouteDeps["githubRequest"]>,
        updateRequest: doUpdateRequest,
      })
      const res = await callSync(deps, "req_noreconcile", { repair: "1" })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body.sync?.mode === "repair", "repair mode when repair=1")
      assert(reconcileRunPaths.length === 0, `reconcile run fetch must not be called when needsReconcile false, got ${reconcileRunPaths.length}`)
    },
  },
  {
    name: "GET /api/requests/[id]/sync: reconcile failure is swallowed and route returns 200",
    fn: async () => {
      const store = new Map<string, Record<string, unknown>>()
      const reqReconcileFail = minimalRequest({
        targetOwner: "o",
        targetRepo: "r",
        runs: {
          plan: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
          apply: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 999, status: "in_progress", dispatchedAt: "2026-01-01T00:00:00Z" }] },
          destroy: { currentAttempt: 1, attempts: [{ attempt: 1, runId: 1, status: "completed", conclusion: "success", dispatchedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z" }] },
        },
      })
      store.set("req_reconcile_fail", reqReconcileFail)
      const doUpdateRequest = async (requestId: string, mutate: (c: Record<string, unknown>) => Record<string, unknown>) => {
        const current = store.get(requestId) as Record<string, unknown>
        if (!current) throw new Error("Request not found")
        const next = mutate(current)
        store.set(requestId, next)
        return [next, true] as [Record<string, unknown>, boolean]
      }
      const deps = defaultDeps({
        getRequest: async (id) => store.get(id) ?? null,
        getRequestOrgId: async (id) => (store.get(id) as { org_id?: string })?.org_id ?? "org_default",
        getGitHubAccessToken: async () => "fake-token",
        githubRequest: (async (opts: { path: string; [k: string]: unknown }) => {
          if (opts.path.includes("/actions/runs/") && !opts.path.includes("/workflows/")) {
            throw new Error("Simulated reconcile fetch failure")
          }
          if (opts.path.includes("/pulls/") && !opts.path.includes("/reviews")) return { number: 1, html_url: "https://x", state: "closed", merged: true }
          if (opts.path.includes("/reviews")) return []
          if (opts.path.includes("workflow_runs") || opts.path.includes("workflows/")) return { workflow_runs: [] }
          return {}
        }) as NonNullable<SyncRouteDeps["githubRequest"]>,
        updateRequest: doUpdateRequest,
      })
      const res = await callSync(deps, "req_reconcile_fail", { repair: "1" })
      assert(res.status === 200, `expected 200 when reconcile throws (error swallowed), got ${res.status}`)
      const body = await res.json()
      assert(body.success === true, "success despite reconcile failure")
    },
  },
  {
    name: "GET /api/requests/[id]/sync: hydrate=1 enters GitHub path and returns repair mode",
    fn: async () => {
      const store = new Map<string, Record<string, unknown>>()
      const reqHydrate = minimalRequest({ targetOwner: "o", targetRepo: "r" })
      store.set("req_hydrate", reqHydrate)
      let getTokenCalled = false
      const doUpdateRequest = async (requestId: string, mutate: (c: Record<string, unknown>) => Record<string, unknown>) => {
        const current = store.get(requestId) as Record<string, unknown>
        if (!current) throw new Error("Request not found")
        const next = mutate(current)
        store.set(requestId, next)
        return [next, true] as [Record<string, unknown>, boolean]
      }
      const deps = defaultDeps({
        getRequest: async (id) => store.get(id) ?? null,
        getRequestOrgId: async (id) => (store.get(id) as { org_id?: string })?.org_id ?? "org_default",
        getGitHubAccessToken: async () => {
          getTokenCalled = true
          return "fake-token"
        },
        githubRequest: (async (opts: { path: string; [k: string]: unknown }) => {
          if (opts.path.includes("/pulls/") && !opts.path.includes("/reviews")) return { number: 1, html_url: "https://x", state: "closed", merged: true }
          if (opts.path.includes("/reviews")) return []
          if (opts.path.includes("workflow_runs") || opts.path.includes("workflows/")) return { workflow_runs: [] }
          return {}
        }) as NonNullable<SyncRouteDeps["githubRequest"]>,
        updateRequest: doUpdateRequest,
      })
      const res = await callSync(deps, "req_hydrate", { hydrate: "1" })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      assert(getTokenCalled, "getGitHubAccessToken must be called when hydrate=1")
      const body = await res.json()
      assert(body.sync?.mode === "repair", "hydrate=1 triggers repair path and returns repair mode")
    },
  },
]
