/**
 * Helpers for drift plan v2 dispatch.
 * Workflow inputs: workspace_key, workspace_slug.
 */

export function buildDriftPlanInputs(ws: {
  workspace_key: string
  workspace_slug: string
}): Record<string, string> {
  return {
    workspace_key: ws.workspace_key,
    workspace_slug: ws.workspace_slug,
  }
}

/** Expected path for drift-plan JSON artifact under workspace root (envs/ path is historical). */
export function expectedDriftPlanJsonPath(workspaceKey: string, workspaceSlug: string): string {
  return `envs/${workspaceKey}/${workspaceSlug}/plan.json`
}
