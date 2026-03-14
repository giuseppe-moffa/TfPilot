/**
 * Helpers for workspace destroy dispatch (destroy_scope="workspace").
 * Workflow inputs: workspace_id, workspace_key, workspace_slug.
 */

export function buildWorkspaceDestroyInputs(ws: {
  workspace_id?: string
  workspace_key?: string
  workspace_slug?: string
}): Record<string, string> {
  const wsId = ws.workspace_id ?? ""
  const wsKey = ws.workspace_key ?? ""
  const wsSlug = ws.workspace_slug ?? ""

  const inputs: Record<string, string> = {
    workspace_id: wsId,
    workspace_key: wsKey,
    workspace_slug: wsSlug,
    destroy_scope: "workspace",
  }
  return inputs
}
