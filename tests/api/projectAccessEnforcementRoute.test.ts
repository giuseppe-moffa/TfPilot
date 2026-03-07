/**
 * API route tests: project access enforcement with RBAC.
 * Skipped by default. Use TEST_SKIP_API=0 with npm run dev.
 * Requires TEST_SESSION_COOKIE (admin), TEST_SESSION_COOKIE_DEVELOPER,
 * TEST_SESSION_COOKIE_APPROVER for role-specific tests.
 * Optional: TEST_REQUEST_ID, TEST_ENVIRONMENT_ID for resource routes.
 * Optional: TEST_SESSION_COOKIE_NO_ACCESS, TEST_REQUEST_ID_OTHER_ORG for edge cases.
 */

const BASE = process.env.TEST_API_BASE_URL || "http://localhost:3000"
const SKIP = process.env.TEST_SKIP_API !== "0"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function handleConnectionError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    throw new Error(
      "API tests require dev server. Run 'npm run dev' or set TEST_SKIP_API=1 to skip."
    )
  }
  throw err
}

function fetchWithCookie(
  url: string,
  opts: { method?: string; body?: string; headers?: Record<string, string> },
  cookie: string
): Promise<Response> {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
      Cookie: cookie,
    },
  })
}

const REQUEST_BODY = {
  project_key: "core",
  environment_key: "dev",
  environment_slug: "test",
  module: "s3-bucket",
  config: { name: "test-bucket" },
}

const ENV_BODY = {
  project_key: "core",
  environment_key: "dev",
  environment_slug: "rbac-test",
}

export const tests = [
  // --- Unauthenticated (existing) ---
  {
    name: "POST /api/requests: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetch(`${BASE}/api/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(REQUEST_BODY),
        })
        assert(res.status === 401, `expected 401, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetch(`${BASE}/api/environments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ENV_BODY),
        })
        assert(res.status === 401, `expected 401, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/requests/[id]/can-destroy: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetch(`${BASE}/api/requests/req_nonexistent/can-destroy`, {
          credentials: "omit",
        })
        assert(res.status === 401, `expected 401, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 1. POST /api/requests ---
  {
    name: "POST /api/requests: developer + project access -> allowed (no 403 project access)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests`,
          { method: "POST", body: JSON.stringify(REQUEST_BODY) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || body?.error !== "No project access",
          `expected allowed (no project access denial), got ${res.status} ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests: approver + project access -> allowed (no 403 project access)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_APPROVER
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests`,
          { method: "POST", body: JSON.stringify(REQUEST_BODY) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || body?.error !== "No project access",
          `expected allowed (no project access denial), got ${res.status} ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests: no project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NO_ACCESS
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests`,
          { method: "POST", body: JSON.stringify(REQUEST_BODY) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          body?.error === "No project access",
          `expected error "No project access", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 2. POST /api/environments ---
  {
    name: "POST /api/environments: developer + project access -> allowed (no 403 project access)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments`,
          { method: "POST", body: JSON.stringify(ENV_BODY) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || body?.error !== "No access to this project",
          `expected allowed (no project access denial), got ${res.status} ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: no project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NO_ACCESS
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments`,
          { method: "POST", body: JSON.stringify(ENV_BODY) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          body?.error === "No access to this project",
          `expected error "No access to this project", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 3. POST /api/requests/[requestId]/apply ---
  {
    name: "POST /api/requests/[id]/apply: approver + project access -> allowed (no 403/404 auth)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_APPROVER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/apply`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || !String(body?.error || "").includes("role"),
          `expected past RBAC, got ${res.status} ${JSON.stringify(body)}`
        )
        assert(
          res.status !== 404 || body?.error !== "Not found",
          `expected past project access, got 404 ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/apply: admin + project access -> allowed (no 403/404 auth)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/apply`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || !String(body?.error || "").includes("role"),
          `expected past RBAC, got ${res.status} ${JSON.stringify(body)}`
        )
        assert(
          res.status !== 404 || body?.error !== "Not found",
          `expected past project access, got 404 ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/apply: developer + project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/apply`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          String(body?.error || "").includes("role") || String(body?.error || "").includes("Apply"),
          `expected role error, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/apply: approver without project access -> 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_APPROVER_NO_ACCESS
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/apply`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 4. POST /api/requests/[requestId]/approve ---
  {
    name: "POST /api/requests/[id]/approve: approver + project access -> allowed",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_APPROVER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/approve`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || !String(body?.error || "").includes("role"),
          `expected past RBAC, got ${res.status} ${JSON.stringify(body)}`
        )
        assert(
          res.status !== 404 || body?.error !== "Not found",
          `expected past project access, got 404 ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/approve: developer + project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/approve`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          String(body?.error || "").includes("role") || String(body?.error || "").includes("Approval"),
          `expected role error, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/approve: approver without project access -> 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_APPROVER_NO_ACCESS
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/approve`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 5. POST /api/requests/[requestId]/destroy ---
  {
    name: "POST /api/requests/[id]/destroy: admin + project access -> allowed (no 403/404 auth)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || !String(body?.error || "").includes("role"),
          `expected past RBAC, got ${res.status} ${JSON.stringify(body)}`
        )
        assert(
          res.status !== 404 || body?.error !== "Not found",
          `expected past project access, got 404 ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/destroy: admin without project access -> 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ADMIN_NO_ACCESS
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests/[id]/destroy: developer with project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests/${requestId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          String(body?.error || "").includes("role") || String(body?.error || "").includes("Destroy"),
          `expected role error, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 6. GET /api/requests/[requestId]/can-destroy ---
  {
    name: "GET /api/requests/[id]/can-destroy: admin + project access -> canDestroy true or prod allowlist",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetch(`${BASE}/api/requests/${requestId}/can-destroy`, {
          headers: { Cookie: cookie },
        })
        const body = await res.json().catch(() => ({}))
        assert(res.status === 200, `expected 200, got ${res.status}`)
        assert(
          body?.canDestroy === true || body?.reason === "not_in_destroy_prod_allowlist",
          `expected canDestroy true or prod allowlist reason, got ${JSON.stringify(body)}`
        )
        assert(
          body?.reason !== "requires_admin_role" && body?.reason !== "no_project_access",
          `expected no RBAC/project denial, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/requests/[id]/can-destroy: admin without project access -> canDestroy false",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ADMIN_NO_ACCESS
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetch(`${BASE}/api/requests/${requestId}/can-destroy`, {
          headers: { Cookie: cookie },
        })
        const body = await res.json().catch(() => ({}))
        assert(res.status === 200, `expected 200, got ${res.status}`)
        assert(body?.canDestroy === false, `expected canDestroy false, got ${JSON.stringify(body)}`)
        assert(
          body?.reason === "no_project_access",
          `expected reason no_project_access, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/requests/[id]/can-destroy: developer with project access -> canDestroy false",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      const requestId = process.env.TEST_REQUEST_ID
      if (!cookie || !requestId) return
      try {
        const res = await fetch(`${BASE}/api/requests/${requestId}/can-destroy`, {
          headers: { Cookie: cookie },
        })
        const body = await res.json().catch(() => ({}))
        assert(res.status === 200, `expected 200, got ${res.status}`)
        assert(body?.canDestroy === false, `expected canDestroy false, got ${JSON.stringify(body)}`)
        assert(
          body?.reason === "requires_admin_role",
          `expected reason requires_admin_role, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 7. POST /api/environments/[id]/destroy ---
  {
    name: "POST /api/environments/[id]/destroy: admin + project access -> allowed (no 403/404 auth)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const envId = process.env.TEST_ENVIRONMENT_ID
      if (!cookie || !envId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments/${envId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        const body = await res.json().catch(() => ({}))
        assert(
          res.status !== 403 || !String(body?.error || "").includes("role"),
          `expected past RBAC, got ${res.status} ${JSON.stringify(body)}`
        )
        assert(
          res.status !== 404 || body?.error !== "Not found",
          `expected past project access, got 404 ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments/[id]/destroy: admin without project access -> 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ADMIN_NO_ACCESS
      const envId = process.env.TEST_ENVIRONMENT_ID
      if (!cookie || !envId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments/${envId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments/[id]/destroy: developer with project access -> 403",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_DEVELOPER
      const envId = process.env.TEST_ENVIRONMENT_ID
      if (!cookie || !envId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments/${envId}/destroy`,
          { method: "POST", body: JSON.stringify({}) },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(
          String(body?.error || "").includes("role") || String(body?.error || "").includes("Destroy"),
          `expected role error, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 8. Cross-org request ---
  {
    name: "GET /api/requests/[id]/can-destroy: cross-org (resource.org_id != session.orgId) -> 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const requestIdOtherOrg = process.env.TEST_REQUEST_ID_OTHER_ORG
      if (!cookie || !requestIdOtherOrg) return
      try {
        const res = await fetch(`${BASE}/api/requests/${requestIdOtherOrg}/can-destroy`, {
          headers: { Cookie: cookie },
        })
        assert(res.status === 404, `expected 404 for cross-org, got ${res.status}`)
        const body = await res.json().catch(() => ({}))
        assert(body?.canDestroy === false, `expected canDestroy false, got ${JSON.stringify(body)}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
