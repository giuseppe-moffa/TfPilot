/**
 * Helpers for workspace destroy dispatch (destroy_scope="environment").
 * Accepts workspace_key/workspace_slug/workspace_id (with environment_* fallback for compat).
 * Workflow input keys remain environment_key/environment_slug/environment_id (external contract).
 */

export function buildWorkspaceDestroyInputs(ws: {
  workspace_key?: string
  workspace_slug?: string
  workspace_id?: string
  /** @deprecated Use workspace_key */
  environment_key?: string
  /** @deprecated Use workspace_slug */
  environment_slug?: string
  /** @deprecated Use workspace_id */
  environment_id?: string
}): Record<string, string> {
  const wsKey = ws.workspace_key ?? ws.environment_key ?? ""
  const wsSlug = ws.workspace_slug ?? ws.environment_slug ?? ""
  const wsId = ws.workspace_id ?? ws.environment_id

  const inputs: Record<string, string> = {
    environment_key: wsKey,
    environment_slug: wsSlug,
    destroy_scope: "environment",
  }
  if (wsId) inputs.environment_id = wsId
  return inputs
}
