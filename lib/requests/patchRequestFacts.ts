/**
 * Patch request document with GitHub webhook payloads.
 * Patches are shaped so only specific keys are updated (github, approval, updatedAt, runs).
 * Run state is stored only in request.runs (attempts); webhook updates attempts via patchRunsAttemptByRunId.
 */

import type { WorkflowKind } from "@/lib/github/workflowClassification"
import { ensureRuns, patchAttemptByRunId, patchAttemptRunId, type RunKind, type RunsState } from "@/lib/requests/runsModel"

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
    completed_at?: string
    html_url?: string
    run_attempt?: number
  }
}

const RUN_KINDS: RunKind[] = ["plan", "apply", "destroy"]

/** No-op reasons for DEBUG-only logging when patch returns {}. */
export const PATCH_NOOP_REASONS = {
  kind_not_handled: "kind not in plan/apply/destroy",
  no_run_id: "workflow_run.id missing",
  no_attempt_by_run_id: "no attempt matched by runId",
  no_pending_attempt_by_head_sha: "no attempt with matching head_sha and missing runId",
  patch_no_change: "attempt found but patch would not change state (monotonic or identical)",
} as const

function logNoopReason(
  kind: WorkflowKind,
  runId: number | undefined,
  requestId: string | undefined,
  head_sha: string | undefined,
  reason: keyof typeof PATCH_NOOP_REASONS
): void {
  if (process.env.DEBUG_WEBHOOKS !== "1") return
  console.log("event=webhook.patch.noop_reason", {
    kind,
    runId: runId ?? null,
    requestId: requestId ?? null,
    head_sha: head_sha ?? null,
    reason: PATCH_NOOP_REASONS[reason],
  })
}

/** Partial request update: runs (attempt record matched by runId) + updatedAt. Empty object = no-op. */
export type PatchRunsAttemptResult =
  | { runs: RunsState; updatedAt: string }
  | Record<string, never>

/**
 * Patch the attempt record in request.runs[kind].attempts that matches workflow_run.id.
 * If no attempt matches by runId (e.g. attempt was created without runId at dispatch), try to attach runId
 * to the current attempt that has matching head_sha and no runId, then patch status/conclusion.
 */
export function patchRunsAttemptByRunId(
  current: CurrentRequest & { runs?: RunsState; id?: string },
  kind: WorkflowKind,
  payload: WorkflowRunWebhookPayload
): PatchRunsAttemptResult {
  const run = payload?.workflow_run
  const requestId = current.id

  if (!RUN_KINDS.includes(kind as RunKind)) {
    logNoopReason(kind, run?.id, requestId, run?.head_sha, "kind_not_handled")
    return {}
  }
  if (run?.id == null) {
    logNoopReason(kind, undefined, requestId, run?.head_sha, "no_run_id")
    return {}
  }
  if (process.env.DEBUG_WEBHOOKS === "1") {
    console.log("event=webhook.run_payload_shape", {
      kind,
      runId: run.id,
      requestId,
      keys: Object.keys(run as object).slice(0, 40),
      updated_at: (run as Record<string, unknown>).updated_at,
      status: (run as Record<string, unknown>).status,
      conclusion: (run as Record<string, unknown>).conclusion,
    })
  }
  ensureRuns(current as Record<string, unknown>)
  let runs = current.runs as RunsState
  if (process.env.DEBUG_WEBHOOKS === "1") {
    console.log("event=webhook.patch_run", {
      kind,
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion ?? null,
      updated_at: run.updated_at ?? null,
    })
  }
  let updated = patchAttemptByRunId(runs, kind as RunKind, run.id, {
    status: run.status,
    conclusion: run.conclusion ?? undefined,
    completed_at: run.completed_at,
    updated_at: run.updated_at,
    head_sha: run.head_sha,
  })
  if (!updated && run.head_sha) {
    const op = runs[kind as RunKind]
    const pendingAttempt = op?.attempts?.find(
      (a) => a.runId == null && a.headSha === run.head_sha
    )
    if (pendingAttempt) {
      const withRunId = patchAttemptRunId(runs, kind as RunKind, pendingAttempt.attempt, {
        runId: run.id,
        url: run.html_url,
      })
      if (withRunId) {
        runs = withRunId
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=webhook.patch_run_after_attach", {
            kind,
            runId: run.id,
            status: run.status,
            conclusion: run.conclusion ?? null,
            updated_at: run.updated_at ?? null,
          })
        }
        updated = patchAttemptByRunId(runs, kind as RunKind, run.id, {
          status: run.status,
          conclusion: run.conclusion ?? undefined,
          completed_at: run.completed_at,
          updated_at: run.updated_at,
          head_sha: run.head_sha,
        })
      }
    }
  }
  if (!updated) {
    const op = runs[kind as RunKind]
    const byRunId = op?.attempts?.some((a) => a.runId === run.id)
    const reason = byRunId
      ? "patch_no_change"
      : run.head_sha
        ? "no_pending_attempt_by_head_sha"
        : "no_attempt_by_run_id"
    logNoopReason(kind, run.id, requestId, run.head_sha, reason)
    return {}
  }
  return { runs: updated, updatedAt: nowIso() }
}
