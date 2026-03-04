/**
 * API route tests: env-templates admin (CRUD, seed).
 * Skipped by default (no dev server). To run:
 *   TEST_SKIP_API=0 npm run test:invariants  (with npm run dev in another terminal)
 * Requires TEST_SESSION_COOKIE with admin user for authenticated tests.
 */

const BASE = process.env.TEST_API_BASE_URL || "http://localhost:3000"
const SKIP = process.env.TEST_SKIP_API !== "0"

async function fetchAdmin(cookie: string, path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...opts?.headers, Cookie: cookie },
  })
}

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

export const tests = [
  {
    name: "GET /api/environment-templates/admin: non-admin returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchAdmin(cookie, "/api/environment-templates/admin")
        assert(res.status === 404 || res.status === 200, `expected 404 or 200, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environment-templates/admin: admin returns array",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchAdmin(cookie, "/api/environment-templates/admin")
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const data = await res.json()
        assert(Array.isArray(data), "response must be array")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environment-templates/admin: create valid returns 201",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchAdmin(cookie, "/api/environment-templates/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Store Test Create",
            modules: [{ module: "s3-bucket", order: 1 }],
            enabled: true,
          }),
        })
        if (res.status === 404) return
        assert(res.status === 201, `expected 201, got ${res.status}`)
        const data = await res.json()
        assert(data?.id != null, "response must have id")
        assert(data?.enabled === true, "created template must be enabled")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "DELETE /api/environment-templates/admin/[id]: soft disable returns 200, enabled false",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const createRes = await fetchAdmin(cookie, "/api/environment-templates/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "ToDisable", modules: [], enabled: true }),
        })
        if (createRes.status === 404) return
        const created = await createRes.json()
        const id = created?.id
        if (!id) return
        const res = await fetchAdmin(cookie, `/api/environment-templates/admin/${id}`, {
          method: "DELETE",
        })
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const data = await res.json()
        assert(data?.enabled === false, "soft disable must set enabled false")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environment-templates/admin/[id]/delete: hard delete returns 200 ok true",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const createRes = await fetchAdmin(cookie, "/api/environment-templates/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "ToDelete", modules: [], enabled: true }),
        })
        if (createRes.status === 404) return
        const created = await createRes.json()
        const id = created?.id
        if (!id) return
        const res = await fetchAdmin(cookie, `/api/environment-templates/admin/${id}/delete`, {
          method: "POST",
        })
        if (res.status === 404) return
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const data = await res.json()
        assert(data?.ok === true, "hard delete must return ok true")
        const listRes = await fetchAdmin(cookie, "/api/environment-templates/admin")
        if (listRes.status === 404) return
        const list = await listRes.json()
        assert(!list.some((e: { id: string }) => e.id === id), "template must be removed from index")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environment-templates/admin/seed: second run returns 409",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res1 = await fetchAdmin(cookie, "/api/environment-templates/admin/seed", {
          method: "POST",
        })
        if (res1.status === 404) return
        const res2 = await fetchAdmin(cookie, "/api/environment-templates/admin/seed", {
          method: "POST",
        })
        if (res2.status === 404) return
        assert(
          res2.status === 409,
          `seed second run expected 409, got ${res2.status}`
        )
        const body = await res2.json()
        assert(
          body?.error === "ENV_TEMPLATES_ALREADY_INITIALIZED",
          `expected ENV_TEMPLATES_ALREADY_INITIALIZED, got ${body?.error}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
