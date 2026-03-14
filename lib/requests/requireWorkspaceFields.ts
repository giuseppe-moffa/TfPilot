/**
 * Require workspace fields on request for destroy and cleanup.
 * Workspace-only; no environment fallbacks.
 */

export function getMissingWorkspaceFields(req: Record<string, unknown>): string[] {
  const missing: string[] = []
  if (!req.workspace_id) missing.push("workspace_id")
  if (!req.workspace_key) missing.push("workspace_key")
  const slug = req.workspace_slug ?? ""
  if (String(slug).trim() === "") missing.push("workspace_slug")
  return missing
}

export function requireWorkspaceFieldsForDestroy(req: Record<string, unknown>): void {
  const missing = getMissingWorkspaceFields(req)
  if (missing.length > 0) {
    throw new Error(`Request missing required workspace fields: ${missing.join(", ")}`)
  }
}
