/**
 * API route tests: GET /api/environments/:id/activity
 * Skipped by default (no dev server). To run:
 *   TEST_SKIP_API=0 npm run test:invariants  (with npm run dev in another terminal)
 * Optional: TEST_SESSION_COOKIE for authenticated test.
 */

const BASE = process.env.TEST_API_BASE_URL || "http://localhost:3000"
const SKIP = process.env.TEST_SKIP_API !== "0"

async function fetchActivity(envId: string, cookie?: string): Promise<Response> {
  return fetch(`${BASE}/api/environments/${envId}/activity`, {
    headers: cookie ? { Cookie: cookie } : {},
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
    name: "GET /api/environments/:id/activity: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetchActivity("env_any")
        assert(res.status === 401, `expected 401, got ${res.status}`)
        const body = await res.json()
        assert(body?.error != null, "expected error field")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environments/:id/activity: not found returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchActivity("env_nonexistent_xyz", cookie)
        assert(res.status === 404, `expected 404, got ${res.status}`)
        const body = await res.json()
        assert(body?.error === "NOT_FOUND", `expected NOT_FOUND, got ${body?.error}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environments/:id/activity: authenticated returns activity array",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      // Use a real env id from DB if available; 404 is acceptable when env doesn't exist
      const envId = process.env.TEST_ENV_ID || "env_nonexistent"
      try {
        const res = await fetchActivity(envId, cookie)
        if (res.status === 404) return // env not in test DB
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const data = await res.json()
        assert(Array.isArray(data.activity), "activity must be array")
        data.activity.forEach((evt: unknown, i: number) => {
          const e = evt as { type?: string; timestamp?: string }
          assert(typeof e.type === "string", `event ${i} has type`)
          assert(typeof e.timestamp === "string", `event ${i} has timestamp`)
        })
        if (data.warning) {
          assert(data.warning === "ENV_DEPLOY_CHECK_FAILED", "warning if present")
        }
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
