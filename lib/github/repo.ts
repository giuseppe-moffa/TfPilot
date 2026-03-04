/**
 * Repo utilities for GitHub integration.
 */

/** Parse owner/repo format. Returns null if invalid. */
export function parseRepoFullName(repo_full_name: string): { owner: string; repo: string } | null {
  const parts = repo_full_name.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}
