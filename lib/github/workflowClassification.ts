/**
 * Classify a workflow_run webhook payload by workflow name (plan / apply / destroy / cleanup).
 */

export type WorkflowKind = "plan" | "apply" | "destroy" | "cleanup"

const KINDS: WorkflowKind[] = ["plan", "apply", "destroy", "cleanup"]

/**
 * Classify workflow run by name (case-insensitive contains).
 * Returns null if no match.
 */
export function classifyWorkflowRun(payload: {
  workflow_run?: { name?: string | null }
}): WorkflowKind | null {
  const name = payload?.workflow_run?.name ?? ""
  if (!name || typeof name !== "string") return null
  const lower = name.toLowerCase()
  for (const kind of KINDS) {
    if (lower.includes(kind)) return kind
  }
  return null
}
