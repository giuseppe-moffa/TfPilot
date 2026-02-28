import { recordGitHubCall } from "@/lib/observability/github-metrics"

type GHInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> }

const GITHUB_BASE = "https://api.github.com"

function ghHeaders(token: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(extra || {}),
  }
}

function parseHeaderInt(val: string | null): number | null {
  if (val === null || val === "") return null
  const n = parseInt(val, 10)
  return Number.isNaN(n) ? null : n
}

/** Returns the raw Response without throwing. Used by rate-aware layer to read rate-limit headers on 403/429. */
export async function ghResponse(token: string, path: string, init: GHInit = {}): Promise<Response> {
  const start = Date.now()
  let res: Response
  try {
    res = await fetch(`${GITHUB_BASE}${path}`, {
      ...init,
      headers: ghHeaders(token, init.headers as Record<string, string>),
    })
  } catch (err) {
    const durationMs = Date.now() - start
    recordGitHubCall({
      status: 599,
      remaining: null,
      reset: null,
      limit: null,
      retryAfter: null,
      durationMs,
      routeKey: path,
      rateLimited: false,
      errorType: "fetch",
    })
    throw err instanceof Error ? err : new Error(String(err))
  }

  const durationMs = Date.now() - start
  const status = res.status

  const remaining = parseHeaderInt(res.headers.get("x-ratelimit-remaining"))
  const reset = parseHeaderInt(res.headers.get("x-ratelimit-reset"))
  const limit = parseHeaderInt(res.headers.get("x-ratelimit-limit"))
  const retryAfter = parseHeaderInt(res.headers.get("retry-after"))

  let rateLimited = status === 429
  if (status === 403) {
    if (remaining === 0) {
      rateLimited = true
    } else {
      const bodyText = await res.clone().text().catch(() => "")
      const lower = bodyText.toLowerCase()
      if (lower.includes("rate limit") || lower.includes("secondary rate limit")) rateLimited = true
    }
  }

  recordGitHubCall({
    status,
    remaining,
    reset,
    limit,
    retryAfter,
    durationMs,
    routeKey: path,
    rateLimited,
  })

  return res
}

export async function gh(token: string, path: string, init: GHInit = {}) {
  const res = await ghResponse(token, path, init)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const err = new Error(`GitHub API error ${res.status}: ${text || res.statusText}`)
    ;(err as any).status = res.status
    throw err
  }
  return res
}
