/**
 * Fetch public GitHub user profile. Best-effort: never throws.
 * Used for enriching org membership display (name, avatar).
 * Uses GITHUB_SERVER_TOKEN if available for higher rate limits.
 */

export type GitHubUserProfile = {
  name: string | null
  avatar_url: string | null
}

/**
 * Fetch GitHub user profile by login. Returns null on any failure.
 * Never blocks membership creation.
 */
export async function fetchGitHubUserProfile(login: string): Promise<GitHubUserProfile | null> {
  if (!login?.trim()) return null
  const token = process.env.GITHUB_SERVER_TOKEN
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login.trim())}`, {
      headers,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { name?: string | null; avatar_url?: string | null }
    return {
      name: typeof json.name === "string" ? json.name : null,
      avatar_url: typeof json.avatar_url === "string" ? json.avatar_url : null,
    }
  } catch {
    return null
  }
}
