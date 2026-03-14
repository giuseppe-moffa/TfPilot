/**
 * Pure builder for Workspace Activity timeline.
 * Derives events from deploy status + request index rows only (no S3 reads, no run/attempt data).
 */

export const ACTIVITY_EVENT_TYPES = [
  "workspace_deployed",
  "workspace_deploy_pr_open",
  "request_created",
  "plan_succeeded",
  "plan_failed",
  "apply_succeeded",
  "apply_failed",
  "destroy_succeeded",
  "destroy_failed",
] as const

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number]

export type ActivityEvent = {
  type: ActivityEventType
  timestamp: string
  request_id?: string
  module?: string
  pr_url?: string
  pr_number?: number
}

export type DeployStatusInput = {
  deployed?: boolean
  deployPrOpen?: boolean | null
  deployPrUrl?: string
  deployCheckFailed?: boolean
  deployTimestamp?: string
}

export type RequestIndexRowForActivity = {
  request_id: string
  created_at: string
  updated_at: string
  module_key: string | null
  pr_number: number | null
}

export type BuildActivityInput = {
  workspace: { workspace_key: string; workspace_slug: string }
  deployStatus: DeployStatusInput
  requests: RequestIndexRowForActivity[]
}

export type ActivityResult = {
  activity: ActivityEvent[]
  warning?: string
}

/**
 * Build workspace activity timeline from deploy status + request index rows.
 * Newest first. Uses only projection data; no run/attempt data available.
 */
export function buildWorkspaceActivity(input: BuildActivityInput): ActivityResult {
  const { deployStatus, requests } = input
  const events: ActivityEvent[] = []
  const warning: string | undefined =
    deployStatus.deployCheckFailed ? "WORKSPACE_DEPLOY_CHECK_FAILED" : undefined
  const deployTs = deployStatus.deployTimestamp ?? new Date().toISOString()

  if (!deployStatus.deployCheckFailed) {
    if (deployStatus.deployed === true) {
      events.push({ type: "workspace_deployed", timestamp: deployTs })
    }
    if (deployStatus.deployPrOpen === true) {
      events.push({
        type: "workspace_deploy_pr_open",
        timestamp: deployTs,
        pr_url: deployStatus.deployPrUrl,
      })
    }
  }

  for (const row of requests) {
    const createdAt = row.created_at
    if (createdAt) {
      events.push({
        type: "request_created",
        timestamp: createdAt,
        request_id: row.request_id,
        module: row.module_key ?? undefined,
        pr_number: row.pr_number ?? undefined,
      })
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return { activity: events, warning }
}
