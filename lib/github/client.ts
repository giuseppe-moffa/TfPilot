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

/** Returns the raw Response without throwing. Used by rate-aware layer to read rate-limit headers on 403/429. */
export async function ghResponse(token: string, path: string, init: GHInit = {}): Promise<Response> {
  const res = await fetch(`${GITHUB_BASE}${path}`, {
    ...init,
    headers: ghHeaders(token, init.headers as Record<string, string>),
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
