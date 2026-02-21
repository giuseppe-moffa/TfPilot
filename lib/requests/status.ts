export type RequestStatus =
  | "created"
  | "pr_open"
  | "planning"
  | "plan_ready"
  | "awaiting_approval"
  | "approved"
  | "merged"
  | "applying"
  | "complete"
  | "failed"

type RunInfo = {
  status?: string
  conclusion?: string
  runId?: number
  url?: string
  headSha?: string
}

type PrInfo = {
  merged?: boolean
  headSha?: string
  open?: boolean
}

type ApprovalInfo = {
  approved?: boolean
  approvers?: string[]
}

export function deriveStatus(input: {
  pr?: PrInfo
  planRun?: RunInfo
  applyRun?: RunInfo
  approval?: ApprovalInfo
}): { status: RequestStatus; reason?: string } {
  const { pr, planRun, applyRun, approval } = input
  const failedConclusions = ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]

  if (applyRun?.conclusion && failedConclusions.includes(applyRun.conclusion)) {
    return { status: "failed", reason: "Apply failed or was cancelled" }
  }
  if (planRun?.conclusion && failedConclusions.includes(planRun.conclusion)) {
    return { status: "failed", reason: "Plan failed or was cancelled" }
  }

  if (applyRun?.status === "in_progress" || applyRun?.status === "queued") {
    return { status: "applying", reason: "Apply running" }
  }

  if (applyRun?.conclusion === "success") {
    return { status: "complete", reason: "Apply succeeded" }
  }

  if (pr?.merged) {
    return { status: "merged", reason: "PR merged" }
  }

  if (planRun?.status === "in_progress" || planRun?.status === "queued") {
    return { status: "planning", reason: "Plan running" }
  }

  if (planRun?.conclusion === "success") {
    if (approval?.approved) {
      return { status: "approved", reason: "Approved in GitHub" }
    }
    return { status: "plan_ready", reason: "Plan succeeded" }
  }

  if (pr?.open) {
    return { status: "pr_open", reason: "PR open" }
  }

  return { status: "created", reason: "Pending PR creation" }
}

/** Display label for UI (table + detail). Single source of truth so list and detail match. */
export function getDisplayStatusLabel(status: string | undefined): string {
  const s = status ?? "pending"
  switch (s) {
    case "destroyed":
      return "Destroyed"
    case "destroying":
      return "Destroying"
    case "complete":
    case "applied":
      return "Deployment Completed"
    case "merged":
    case "applying":
      return "Pull request merged"
    case "approved":
    case "awaiting_approval":
      return "Approved"
    case "plan_ready":
    case "planned":
      return "Plan ready"
    case "planning":
    case "pr_open":
    case "created":
      return "Planning in progress"
    case "failed":
      return "Failed"
    default:
      return "Request created"
  }
}
