/**
 * Patch request document with GitHub webhook payloads.
 * Patches are shaped so only specific keys are updated (github, approval, updatedAt).
 * Never removes existing workflow facts (planRun, applyRun, destroyRun).
 */

import type { WorkflowKind } from "@/lib/github/workflowClassification"

function nowIso(): string {
  return new Date().toISOString()
}

type PrPayload = {
  number?: number
  html_url?: string
  state?: string
  merged?: boolean
  merged_at?: string | null
  head?: { sha?: string; ref?: string }
  title?: string
}

type GithubPrShape = {
  number?: number
  url?: string
  merged?: boolean
  headSha?: string
  open?: boolean
}

/** Normalized run fact stored under github.workflows[kind]. */
export type RunFact = {
  runId?: number
  status?: string
  conclusion?: string
  headSha?: string
  createdAt?: string
  updatedAt?: string
  htmlUrl?: string
  attempt?: number
  /** Optional: e.g. display_title from webhook when run is cancelled (for concurrency tooltip). */
  message?: string
}

/** Cleanup dispatch state (retry-safe). */
export type CleanupDispatchStatus = "pending" | "dispatched" | "error"

export type CleanupDispatchState = {
  cleanupTriggeredForDestroyRunId?: number
  cleanupDispatchStatus?: CleanupDispatchStatus
  cleanupDispatchLastError?: string
  cleanupDispatchAttemptedAt?: string
}

type CurrentRequest = {
  github?: {
    pr?: GithubPrShape
    workflows?: Partial<Record<WorkflowKind, RunFact>>
    cleanupTriggeredForDestroyRunId?: number
    cleanupDispatchStatus?: CleanupDispatchStatus
    cleanupDispatchLastError?: string
    cleanupDispatchAttemptedAt?: string
  }
  prNumber?: number
  prUrl?: string
  approval?: { approved?: boolean; approvers?: string[] }
  updatedAt?: string
}

/** Full GitHub webhook payload for pull_request event (patch uses payload.pull_request). */
export type PullRequestWebhookPayload = { pull_request?: PrPayload }

/** Partial request update: github, prNumber, prUrl (for UI), updatedAt. Merge as-is; do not spread into root. */
export type PatchGithubPrResult = {
  github: { pr: GithubPrShape }
  prNumber?: number
  prUrl?: string
  updatedAt: string
}

/**
 * Returns a partial update: { github: { ...current.github, pr }, updatedAt }.
 * Do not spread this into root; merge as-is so no other fields are overwritten.
 */
export function patchGithubPr(
  current: CurrentRequest,
  payload: PullRequestWebhookPayload
): PatchGithubPrResult {
  const prPayload = payload.pull_request ?? {}
  const open = prPayload.state === "open"
  const merged = Boolean(prPayload.merged ?? prPayload.merged_at)
  const headSha = prPayload.head?.sha
  const updatedAt = nowIso()

  const pr: GithubPrShape = {
    ...current.github?.pr,
    number: prPayload.number ?? current.github?.pr?.number,
    url: prPayload.html_url ?? current.github?.pr?.url,
    merged: merged ?? current.github?.pr?.merged,
    headSha: headSha ?? current.github?.pr?.headSha,
    open: open ?? current.github?.pr?.open,
  }
  return {
    github: { ...current.github, pr },
    ...(pr.number != null && { prNumber: pr.number }),
    ...(pr.url && { prUrl: pr.url }),
    updatedAt,
  }
}

type ReviewPayload = {
  state?: string
  user?: { login?: string }
}

/** Full GitHub webhook payload for pull_request_review event (patch uses payload.review). */
export type PullRequestReviewWebhookPayload = { review?: ReviewPayload }

/** Partial request update: only approval and updatedAt. Merge as-is; do not spread into root. */
export type PatchGithubReviewsResult = {
  approval: { approved: boolean; approvers: string[] }
  updatedAt: string
}

/**
 * Returns a partial update: { approval: { ...current.approval, approved, approvers }, updatedAt }.
 * Merge as-is so no other fields are overwritten.
 */
export function patchGithubReviews(
  current: CurrentRequest,
  payload: PullRequestReviewWebhookPayload
): PatchGithubReviewsResult {
  const reviewPayload = payload.review ?? {}
  const state = reviewPayload.state
  const login = reviewPayload.user?.login
  const updatedAt = nowIso()

  const existingApprovers = current.approval?.approvers ?? []
  let approved: boolean = current.approval?.approved ?? false
  let approvers: string[] = [...existingApprovers]

  if (state === "APPROVED" && login) {
    approved = true
    if (!approvers.includes(login)) approvers = [...approvers, login]
  } else if (state === "CHANGES_REQUESTED") {
    approved = false
  }

  return {
    approval: { ...current.approval, approved, approvers },
    updatedAt,
  } as PatchGithubReviewsResult
}

// --- workflow_run ---

/** Full GitHub webhook payload for workflow_run event. */
export type WorkflowRunWebhookPayload = {
  workflow_run?: {
    id?: number
    name?: string
    display_title?: string
    status?: string
    conclusion?: string | null
    head_sha?: string
    created_at?: string
    updated_at?: string
    html_url?: string
    run_attempt?: number
  }
}

/** Partial request update: github.workflows[kind] + updatedAt. Merge as-is. Empty object = no-op (idempotent). */
export type PatchWorkflowRunResult =
  | { github: { workflows: Partial<Record<WorkflowKind, RunFact>> }; updatedAt: string }
  | Record<string, never>

function parseIso(iso: string | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return isNaN(t) ? 0 : t
}

/**
 * Returns a partial update with github.workflows[kind] set from payload.
 * Monotonic guards (no regression from out-of-order webhooks):
 * - If existing.conclusion != null: ignore incoming event where conclusion == null.
 * - If existing.status === "completed": ignore incoming status in_progress or queued.
 * - If existing in_progress/queued and incoming is older (by updated_at): keep existing.
 * Always allowed: null → in_progress, null → completed, in_progress → completed.
 */
export function patchWorkflowRun(
  current: CurrentRequest,
  kind: WorkflowKind,
  payload: WorkflowRunWebhookPayload
): PatchWorkflowRunResult {
  const run = payload?.workflow_run
  const updatedAt = nowIso()
  const existing = current.github?.workflows?.[kind]

  // Only write onto the request when runId matches tracked run (prevents cross-request pollution for all kinds)
  const cur = current as {
    github?: { workflows?: Partial<Record<WorkflowKind, RunFact>> }
    planRun?: { runId?: number }
    applyRun?: { runId?: number }
    destroyRun?: { runId?: number }
  }
  const trackedRunId =
    cur.github?.workflows?.[kind]?.runId ??
    (kind === "plan" ? cur.planRun?.runId : kind === "apply" ? cur.applyRun?.runId : kind === "destroy" ? cur.destroyRun?.runId : undefined)
  if (run?.id != null && trackedRunId != null && trackedRunId !== run.id) {
    return {
      github: { ...current.github, workflows: { ...current.github?.workflows } },
      updatedAt,
    }
  }

  const runFact: RunFact = {
    runId: run?.id ?? existing?.runId,
    status: run?.status ?? existing?.status,
    conclusion: run?.conclusion ?? existing?.conclusion ?? undefined,
    headSha: run?.head_sha ?? existing?.headSha,
    createdAt: run?.created_at ?? existing?.createdAt,
    updatedAt: run?.updated_at ?? existing?.updatedAt,
    htmlUrl: run?.html_url ?? existing?.htmlUrl,
    attempt: run?.run_attempt ?? existing?.attempt,
    message: run?.display_title ?? (existing as RunFact)?.message,
  }

  const incomingActive =
    runFact.status === "in_progress" || runFact.status === "queued"

  // Monotonic: never overwrite a concluded run with an event that has no conclusion (out-of-order)
  if (existing?.conclusion != null && run?.conclusion == null) {
    return {
      github: { ...current.github, workflows: { ...current.github?.workflows } },
      updatedAt,
    }
  }

  // Monotonic: never overwrite completed with in_progress or queued (out-of-order webhook)
  if (existing?.status === "completed" && incomingActive) {
    return {
      github: { ...current.github, workflows: { ...current.github?.workflows } },
      updatedAt,
    }
  }

  const incomingUpdated = parseIso(run?.updated_at)
  const existingUpdated = parseIso(existing?.updatedAt)
  const existingActive =
    existing?.status === "in_progress" || existing?.status === "queued"
  const existingCompleted = existing?.status === "completed"
  const sameRunId = existing?.runId != null && run?.id != null && existing.runId === run.id

  if (
    existingActive &&
    !incomingActive &&
    incomingUpdated > 0 &&
    existingUpdated > 0 &&
    incomingUpdated < existingUpdated
  ) {
    return {
      github: { ...current.github, workflows: { ...current.github?.workflows } },
      updatedAt,
    }
  }
  if (existingCompleted && incomingActive && sameRunId) {
    return {
      github: { ...current.github, workflows: { ...current.github?.workflows } },
      updatedAt,
    }
  }

  // Idempotency: skip write when status, conclusion, runId already match (duplicate webhook delivery)
  if (
    existing?.status === runFact.status &&
    existing?.conclusion === runFact.conclusion &&
    existing?.runId === runFact.runId
  ) {
    return {}
  }

  const workflows = { ...current.github?.workflows, [kind]: runFact }
  return {
    github: { ...current.github, workflows },
    updatedAt,
  }
}
