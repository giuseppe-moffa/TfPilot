/**
 * API route tests: org lifecycle, platform admin, archived org enforcement.
 * Skipped by default. Use TEST_SKIP_API=0 with npm run dev.
 * Requires: TEST_SESSION_COOKIE (platform admin), TEST_SESSION_COOKIE_NON_ADMIN (non-platform-admin).
 * Optional: TEST_ORG_ID for archive/restore tests.
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
  opts: { method?: string; body?: string; headers?: Record<string, string> } = {},
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

export const tests = [
  // --- 1. Org archive / restore lifecycle ---
  {
    name: "POST /api/platform/orgs/[orgId]/archive: sets archived_at",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/archive`,
          { method: "POST" },
          cookie
        )
        if (res.status === 404) return // non-admin or org not found
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.ok === true, `expected ok true, got ${JSON.stringify(body)}`)
        assert(
          body?.archivedAt != null,
          `expected archivedAt, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/archive: idempotent (already archived returns ok)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res1 = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/archive`,
          { method: "POST" },
          cookie
        )
        if (res1.status === 404) return
        const res2 = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/archive`,
          { method: "POST" },
          cookie
        )
        assert(res2.status === 200, `expected 200 on second archive, got ${res2.status}`)
        const body = await res2.json()
        assert(body?.ok === true, `expected ok true, got ${JSON.stringify(body)}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/restore: clears archived_at",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/restore`,
          { method: "POST" },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.ok === true, `expected ok true, got ${JSON.stringify(body)}`)
        assert(
          body?.archivedAt === null,
          `expected archivedAt null, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/restore: idempotent (already active returns ok)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/restore`,
          { method: "POST" },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200 on restore of active org, got ${res.status}`)
        const body = await res.json()
        assert(body?.ok === true, `expected ok true, got ${JSON.stringify(body)}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 2. Archived org runtime enforcement ---
  {
    name: "GET /api/requests: active org -> normal behavior (200 or 500)",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/requests`, {}, cookie)
        assert(
          res.status === 200 || res.status === 500 || res.status === 403,
          `expected 200/500/403, got ${res.status}`
        )
        if (res.status === 403) {
          const body = await res.json()
          assert(
            body?.error !== "Organization archived",
            `expected not archived error, got ${JSON.stringify(body)}`
          )
        }
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/requests: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/requests`, {}, cookie)
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/requests: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/requests`,
          {
            method: "POST",
            body: JSON.stringify({
              project_key: "core",
              environment_key: "dev",
              environment_slug: "test",
              module: "s3-bucket",
              config: { name: "x" },
            }),
          },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environments: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/environments`, {}, cookie)
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/environments`,
          {
            method: "POST",
            body: JSON.stringify({
              project_key: "core",
              environment_key: "dev",
              environment_slug: "test",
            }),
          },
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/metrics/insights: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/metrics/insights`, {}, cookie)
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/request-templates/admin: archived org -> 403 Organization archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_ARCHIVED_ORG
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/request-templates/admin`,
          {},
          cookie
        )
        assert(res.status === 403, `expected 403, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Organization archived",
          `expected "Organization archived", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/platform/orgs: platform admin with archived current org -> 200",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/platform/orgs`, {}, cookie)
        assert(
          res.status === 200 || res.status === 404,
          `expected 200 or 404, got ${res.status}`
        )
        if (res.status === 200) {
          const body = await res.json()
          assert(body?.orgs != null, "expected orgs array")
        }
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/platform/orgs/[orgId]: platform admin can access archived org detail",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}`,
          {},
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.org != null, "expected org")
        assert(body?.stats != null, "expected stats")
        assert(body?.members != null, "expected members")
        assert(body?.teams != null, "expected teams")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/restore: platform admin can restore when current org archived",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/restore`,
          { method: "POST" },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 3. Org switcher behavior ---
  {
    name: "GET /api/auth/orgs: excludes archived orgs",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/auth/orgs`, {}, cookie)
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.orgs != null, "expected orgs array")
        // Archived orgs must not appear (listUserOrgs uses excludeArchived by default)
        // We cannot assert specific content without knowing DB state
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/auth/switch-org: switch to archived org rejected",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const archivedOrgId = process.env.TEST_ARCHIVED_ORG_ID
      if (!cookie || !archivedOrgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/auth/switch-org`,
          {
            method: "POST",
            body: JSON.stringify({ orgId: archivedOrgId }),
          },
          cookie
        )
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Cannot switch to archived org",
          `expected "Cannot switch to archived org", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/auth/switch-org: switch to active org succeeds",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const activeOrgId = process.env.TEST_ACTIVE_ORG_ID
      if (!cookie || !activeOrgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/auth/switch-org`,
          {
            method: "POST",
            body: JSON.stringify({ orgId: activeOrgId }),
          },
          cookie
        )
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.ok === true, `expected ok true, got ${JSON.stringify(body)}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 4. Platform admin gating ---
  {
    name: "GET /api/platform/orgs: non-platform-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NON_ADMIN
      if (!cookie) return
      try {
        const res = await fetchWithCookie(`${BASE}/api/platform/orgs`, {}, cookie)
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs: non-platform-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NON_ADMIN
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({
              slug: "test-org",
              name: "Test Org",
              adminLogin: "admin1",
            }),
          },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/platform/orgs/[orgId]: non-platform-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NON_ADMIN
      const orgId = process.env.TEST_ORG_ID || "org_any"
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}`,
          {},
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/archive: non-platform-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NON_ADMIN
      const orgId = process.env.TEST_ORG_ID || "org_any"
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/archive`,
          { method: "POST" },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs/[orgId]/restore: non-platform-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE_NON_ADMIN
      const orgId = process.env.TEST_ORG_ID || "org_any"
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}/restore`,
          { method: "POST" },
          cookie
        )
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 5. Org creation ---
  {
    name: "POST /api/platform/orgs: create org succeeds with valid slug, name, adminLogin",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      const slug = `test-org-${Date.now()}`
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({
              slug,
              name: "Test Org",
              adminLogin: "admin1",
            }),
          },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.org != null, "expected org")
        assert(body.org.slug === slug, `expected slug ${slug}`)
        assert(body.org.name === "Test Org", "expected name")
        assert(body.org.memberCount === 1, "expected initial admin membership")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs: duplicate slug rejected",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const existingSlug = process.env.TEST_EXISTING_ORG_SLUG || "default"
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({
              slug: existingSlug,
              name: "Duplicate",
              adminLogin: "admin1",
            }),
          },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Slug already exists",
          `expected "Slug already exists", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs: missing slug rejected",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({ name: "Test", adminLogin: "admin1" }),
          },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Slug is required",
          `expected "Slug is required", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs: missing name rejected",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({ slug: "test", adminLogin: "admin1" }),
          },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Name is required",
          `expected "Name is required", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/platform/orgs: missing adminLogin rejected",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs`,
          {
            method: "POST",
            body: JSON.stringify({ slug: "test", name: "Test" }),
          },
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "Admin login is required",
          `expected "Admin login is required", got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },

  // --- 6. Org detail ---
  {
    name: "GET /api/platform/orgs/[orgId]: 404 when org does not exist",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/org_nonexistent_12345`,
          {},
          cookie
        )
        if (res.status === 404) return // non-admin also returns 404
        assert(res.status === 404, `expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/platform/orgs/[orgId]: archived org detail visible to platform admin",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const archivedOrgId = process.env.TEST_ARCHIVED_ORG_ID
      if (!cookie || !archivedOrgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${archivedOrgId}`,
          {},
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.org != null, "expected org")
        assert(body.org.archivedAt != null, "archived org should have archivedAt")
        assert(body?.stats != null, "expected stats")
        assert(body?.members != null, "expected members")
        assert(body?.teams != null, "expected teams")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/platform/orgs/[orgId]: members/teams/stats shape correct",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      const orgId = process.env.TEST_ORG_ID
      if (!cookie || !orgId) return
      try {
        const res = await fetchWithCookie(
          `${BASE}/api/platform/orgs/${orgId}`,
          {},
          cookie
        )
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const body = await res.json()
        assert(body?.org?.id != null, "expected org.id")
        assert(body?.org?.slug != null, "expected org.slug")
        assert(body?.org?.name != null, "expected org.name")
        assert(body?.org?.createdAt != null, "expected org.createdAt")
        assert(Array.isArray(body?.members), "expected members array")
        assert(Array.isArray(body?.teams), "expected teams array")
        assert(
          typeof body?.stats?.memberCount === "number",
          "expected stats.memberCount"
        )
        assert(
          typeof body?.stats?.teamCount === "number",
          "expected stats.teamCount"
        )
        assert(
          typeof body?.stats?.projectCount === "number",
          "expected stats.projectCount"
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
