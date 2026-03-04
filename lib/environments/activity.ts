/**
 * Pure builder for Environment Activity timeline.
 * Derives events from deploy status + request index rows only (no S3 reads, no run/attempt data).
 *
 * Limitation: requests_index has no runs/attempts.
 * We only emit request_created from created_at. plan/apply/destroy events require S3 doc runs
 * and are not supported in this projection-only implementation.
 */

export const ACTIVITY_EVENT_TYPES = [
  "environment_deployed",
  "environment_deploy_pr_open",
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
  /** When true, omit deploy events and caller should add warning */
  deployCheckFailed?: boolean
  /** Timestamp for deploy events (e.g. env.updated_at); used when deploy state is derived from live check */
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
  env: { environment_key: string; environment_slug: string }
  deployStatus: DeployStatusInput
  requests: RequestIndexRowForActivity[]
}

export type ActivityResult = {
  activity: ActivityEvent[]
  warning?: string
}

/**
 * Build environment activity timeline from deploy status + request index rows.
 * Newest first. Uses only projection data; no run/attempt data available.
 */
export function buildEnvironmentActivity(input: BuildActivityInput): ActivityResult {
  const { env, deployStatus, requests } = input
  const events: ActivityEvent[] = []
  const warning: string | undefined =
    deployStatus.deployCheckFailed ? "ENV_DEPLOY_CHECK_FAILED" : undefined
  const deployTs = deployStatus.deployTimestamp ?? new Date().toISOString()

  // Deploy events: omit when deploy check failed (fail-closed)
  if (!deployStatus.deployCheckFailed) {
    if (deployStatus.deployed === true) {
      events.push({ type: "environment_deployed", timestamp: deployTs })
    }
    if (deployStatus.deployPrOpen === true) {
      events.push({
        type: "environment_deploy_pr_open",
        timestamp: deployTs,
        pr_url: deployStatus.deployPrUrl,
      })
    }
  }

  // Request events: request_created from Postgres projection only
  // Note: plan/apply/destroy events require runs.attempts from S3; not in index.
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

  // Sort newest first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return { activity: events, warning }
}
