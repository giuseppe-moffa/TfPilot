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

  if (applyRun?.conclusion === "failure" || planRun?.conclusion === "failure") {
    return { status: "failed", reason: "Plan or apply failed" }
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
    return { status: "awaiting_approval", reason: "Waiting for approval in GitHub" }
  }

  if (pr?.open) {
    return { status: "pr_open", reason: "PR open" }
  }

  return { status: "created", reason: "Pending PR creation" }
}
