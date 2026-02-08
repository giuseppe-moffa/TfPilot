type GHInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> }

export async function gh(token: string, path: string, init: GHInit = {}) {
  const base = "https://api.github.com"
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const err = new Error(`GitHub API error ${res.status}: ${text || res.statusText}`)
    ;(err as any).status = res.status
    throw err
  }
  return res
}
