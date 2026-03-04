/**
 * Format environment for display in UI.
 * Requires environment_key and environment_slug (no legacy fallback).
 */
export function formatEnvDisplay(key: string, slug: string): string {
  const k = (key ?? "").trim()
  const s = (slug ?? "").trim()
  if (k && s) return `${k} / ${s}`
  if (k) return k
  return "—"
}
