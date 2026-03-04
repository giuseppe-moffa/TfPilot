/**
 * API route tests: GET /api/environment-templates
 * Skipped by default (no dev server). To run:
 *   TEST_SKIP_API=0 npm run test:invariants  (with npm run dev in another terminal)
 * Optional: TEST_SESSION_COOKIE for authenticated test.
 */

const BASE = process.env.TEST_API_BASE_URL || "http://localhost:3000"
const SKIP = process.env.TEST_SKIP_API !== "0"

async function fetchEnvTemplates(cookie?: string): Promise<Response> {
  return fetch(`${BASE}/api/environment-templates`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
}

async function fetchEnvTemplateDetail(id: string, cookie?: string): Promise<Response> {
  return fetch(`${BASE}/api/environment-templates/${id}`, {
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
    name: "GET /api/environment-templates: unauthenticated returns 401",
    fn: async () => {
      if (SKIP) return
      try {
        const res = await fetchEnvTemplates()
        assert(res.status === 401, `expected 401, got ${res.status}`)
        const body = await res.json()
        assert(body?.error != null, "expected error field in 401 response")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environment-templates: authenticated returns template list",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchEnvTemplates(cookie)
        assert(res.status === 200, `expected 200 when authenticated, got ${res.status}`)
        const data = await res.json()
        assert(Array.isArray(data), "response must be array")
        assert(data.length >= 4, "expected at least 4 templates (after seed)")
        const blank = data.find((t: { id: string }) => t.id === "blank")
        assert(blank != null && Array.isArray(blank.modules), "blank template with modules array")
        assert(blank.modules.length === 0, "blank has no modules")
        const ai = data.find((t: { id: string }) => t.id === "baseline-ai-service")
        assert(ai != null, "baseline-ai-service exists")
        assert(
          ai.modules?.some((m: { module: string }) => m.module === "ecr-repo"),
          "baseline-ai-service includes ecr-repo"
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environment-templates: list returns enabled only",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchEnvTemplates(cookie)
        assert(res.status === 200, `expected 200, got ${res.status}`)
        const data = await res.json()
        assert(Array.isArray(data), "response must be array")
        for (const t of data) {
          assert(t.enabled !== false, `template ${t.id} must be enabled (list returns enabled only)`)
        }
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environment-templates/[id]: disabled template returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const createRes = await fetch(`${BASE}/api/environment-templates/admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ label: "ToDisableForDetail", modules: [], enabled: true }),
        })
        if (createRes.status === 404) return
        const created = await createRes.json()
        const id = created?.id
        if (!id) return
        await fetch(`${BASE}/api/environment-templates/admin/${id}`, {
          method: "DELETE",
          headers: { Cookie: cookie },
        })
        const res = await fetchEnvTemplateDetail(id, cookie)
        assert(res.status === 404, `disabled template expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "GET /api/environment-templates/[id]: nonexistent returns 404",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await fetchEnvTemplateDetail("nonexistent-id-xyz", cookie)
        assert(res.status === 404, `nonexistent id expected 404, got ${res.status}`)
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
