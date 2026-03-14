/**
 * Format workspace for display in UI (workspace_key / workspace_slug).
 */
export function formatWorkspaceDisplay(workspace_key: string, workspace_slug: string): string {
  const k = (workspace_key ?? "").trim()
  const s = (workspace_slug ?? "").trim()
  if (k && s) return `${k} / ${s}`
  if (k) return k
  return "—"
}
