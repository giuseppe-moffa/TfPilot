/**
 * API route tests: POST /api/environments template validation.
 * Chunk 3.1 — INVALID_ENV_TEMPLATE, valid template_id, omitted template_id.
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

async function postEnvironment(
  cookie: string,
  body: { project_key: string; environment_key: string; environment_slug: string; template_id?: string | null }
): Promise<Response> {
  return fetch(`${BASE}/api/environments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
}

export const tests = [
  {
    name: "POST /api/environments: invalid template_id returns 400 INVALID_ENV_TEMPLATE",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await postEnvironment(cookie, {
          project_key: "core",
          environment_key: "dev",
          environment_slug: "test-invalid-template",
          template_id: "unknown-template-id",
        })
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "INVALID_ENV_TEMPLATE",
          `expected error INVALID_ENV_TEMPLATE, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: empty string template_id returns 400 INVALID_ENV_TEMPLATE",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      try {
        const res = await postEnvironment(cookie, {
          project_key: "core",
          environment_key: "dev",
          environment_slug: "test-empty-template",
          template_id: "",
        })
        assert(res.status === 400, `expected 400, got ${res.status}`)
        const body = await res.json()
        assert(
          body?.error === "INVALID_ENV_TEMPLATE",
          `expected error INVALID_ENV_TEMPLATE, got ${JSON.stringify(body)}`
        )
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: valid template_id blank returns 201",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      const slug = `chunk31-blank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      try {
        const res = await postEnvironment(cookie, {
          project_key: "core",
          environment_key: "dev",
          environment_slug: slug,
          template_id: "blank",
        })
        assert(res.status === 201, `expected 201, got ${res.status}`)
        const data = await res.json()
        assert(data?.environment != null, "response must include environment")
        assert(data.environment.template_id === "blank", "template_id must be blank")
        assert(typeof data.environment.template_version === "string", "template_version must be set")
        assert(data.environment.archived_at === null, "archived_at must be null on create")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
  {
    name: "POST /api/environments: omitted template_id returns 201",
    fn: async () => {
      if (SKIP) return
      const cookie = process.env.TEST_SESSION_COOKIE
      if (!cookie) return
      const slug = `chunk31-omitted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      try {
        const res = await postEnvironment(cookie, {
          project_key: "core",
          environment_key: "dev",
          environment_slug: slug,
        })
        assert(res.status === 201, `expected 201, got ${res.status}`)
        const data = await res.json()
        assert(data?.environment != null, "response must include environment")
        assert(data.environment.template_id === null, "template_id must be null when omitted")
        assert(typeof data.environment.template_version === "string", "template_version must be set")
        assert(data.environment.archived_at === null, "archived_at must be null on create")
      } catch (err: unknown) {
        handleConnectionError(err)
      }
    },
  },
]
