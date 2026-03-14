/**
 * Audit: identify requests missing workspace fields.
 * Checks workspace_* with environment_* fallback for backward compat.
 */

export function isMissingWorkspaceField(req: Record<string, unknown>): boolean {
  const id = req.workspace_id
  const key = req.workspace_key
  const slug = req.workspace_slug ?? ""
  return !id || !key || String(slug).trim() === ""
}

export function getRequestIdsMissingWorkspace(requests: Array<{ id: string } & Record<string, unknown>>): string[] {
  return requests.filter((r) => isMissingWorkspaceField(r)).map((r) => r.id)
}

/** @deprecated Use isMissingWorkspaceField */
export const isMissingEnvField = isMissingWorkspaceField

/** @deprecated Use getRequestIdsMissingWorkspace */
export const getRequestIdsMissingEnv = getRequestIdsMissingWorkspace
