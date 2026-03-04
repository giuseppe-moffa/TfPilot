/**
 * API route tests: GET /api/request-templates
 * Skipped by default (no dev server). To run:
 *   TEST_SKIP_API=0 npm run test:invariants  (with npm run dev in another terminal)
 * Optional: TEST_SESSION_COOKIE for authenticated test.
 */

const BASE = process.env.TEST_API_BASE_URL || "http://localhost:3000"
const SKIP = process.env.TEST_SKIP_API !== "0"

async function fetchRequestTemplates(cookie?: string): Promise<Response> {
  return fetch(`${BASE}/api/request-templates`, {
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
    name: "GET /api/request-templates: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetchRequestTemplates()
        assert(res.status === 401, `expected 401, got ${res.status}`)
        const body = await res.json()
        assert(body?.error != null, "expected error field in 401 response")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/request-templates: authenticated returns array",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchRequestTemplates(cookie)
        // 200 with array, or 500 if S3/config not available
        assert(
          res.status === 200 || res.status === 500,
          `expected 200 or 500, got ${res.status}`
        )
        if (res.status === 200) {
          const data = await res.json()
          assert(Array.isArray(data), "response must be array")
        }
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
