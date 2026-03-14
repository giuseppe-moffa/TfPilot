/**
 * Helpers for drift plan v2 dispatch.
 * Accepts workspace_key/workspace_slug (with environment_* fallback).
 * Workflow input keys remain environment_key/environment_slug (external contract).
 */

export function buildDriftPlanInputs(ws: {
  workspace_key?: string
  workspace_slug?: string
  /** @deprecated Use workspace_key */
  environment_key?: string
  /** @deprecated Use workspace_slug */
  environment_slug?: string
}): Record<string, string> {
  return {
    environment_key: ws.workspace_key ?? ws.environment_key ?? "",
    environment_slug: ws.workspace_slug ?? ws.environment_slug ?? "",
  }
}

/** Expected path for drift-plan JSON artifact under ENV_ROOT (envs/ path convention preserved). */
export function expectedDriftPlanJsonPath(workspaceKey: string, workspaceSlug: string): string {
  return `envs/${workspaceKey}/${workspaceSlug}/plan.json`
}
