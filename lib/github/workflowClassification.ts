/**
 * Classify a workflow_run webhook payload by workflow name (plan / apply / destroy / cleanup / drift_plan).
 */

export type WorkflowKind = "plan" | "apply" | "destroy" | "cleanup" | "drift_plan"

/**
 * Classification order is explicit so that:
 * - "Drift Plan" (drift + plan) is never misclassified as "plan" by checking drift_plan first.
 * - "plan" is evaluated last so only non-drift plan runs get kind "plan".
 * We do not rely on object/array iteration order.
 */
export function classifyWorkflowRun(payload: {
  workflow_run?: { name?: string | null; display_title?: string | null }
}): WorkflowKind | null {
  const name = payload?.workflow_run?.name ?? ""
  const displayTitle = payload?.workflow_run?.display_title ?? ""
  const combined = `${typeof name === "string" ? name : ""} ${typeof displayTitle === "string" ? displayTitle : ""}`.trim()
  if (!combined) return null
  const lower = combined.toLowerCase()

  if (lower.includes("drift") && lower.includes("plan")) return "drift_plan"
  if (lower.includes("apply")) return "apply"
  if (lower.includes("destroy")) return "destroy"
  if (lower.includes("cleanup")) return "cleanup"
  if (lower.includes("plan")) return "plan"

  return null
}
