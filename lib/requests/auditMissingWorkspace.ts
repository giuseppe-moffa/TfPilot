/**
 * Audit: identify requests missing workspace fields.
 * Workspace-only; no environment fallbacks.
 */

export function isMissingWorkspaceField(req: Record<string, unknown>): boolean {
  const id = req.workspace_id
  const key = req.workspace_key
  const slug = req.workspace_slug ?? ""
  return !id || !key || String(slug).trim() === ""
}

export function getRequestIdsMissingWorkspace(
  requests: Array<{ id: string } & Record<string, unknown>>
): string[] {
  return requests.filter((r) => isMissingWorkspaceField(r)).map((r) => r.id)
}
