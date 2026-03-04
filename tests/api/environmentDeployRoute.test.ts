/**
 * API route tests: POST /api/environments/:id/deploy.
 * Chunk 5.3 — deploy flow, preconditions, rollback.
 * Skipped by default. Use TEST_SKIP_API=0 with npm run dev.
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

async function postDeploy(cookie: string, environmentId: string): Promise<Response> {
  return fetch(`${BASE}/api/environments/${environmentId}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({}),
  })
}

export const tests = [
  {
    name: "POST /api/environments/:id/deploy: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetch(`${BASE}/api/environments/env_abc123/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
        assert(res.status === 401, `expected 401, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments/:id/deploy: environment not found returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await postDeploy(cookie, "env_nonexistent_12345")
        assert(res.status === 404, `expected 404, got ${res.status}`)
        const body = await res.json()
        assert(body?.error === "Environment not found", `expected error, got ${JSON.stringify(body)}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
