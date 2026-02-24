/**
 * Correlate GitHub webhook events to TfPilot request IDs.
 * Branch naming: request/{requestId} (e.g. refs/heads/request/req_dev_ec2_abc).
 * Request IDs match pattern req_[a-z0-9_]+.
 * PR number index fallback: when branch/title/body lack requestId, lookup by owner/repo/prNumber.
 */

import { getRequestIdByPr } from "@/lib/requests/prIndex"

const REQUEST_ID_IN_TEXT = /req_[a-z0-9_]+/g
const REQUEST_BRANCH_PREFIX = "refs/heads/request/"

function refFromBranch(branchName: string): string {
  return branchName.startsWith("refs/") ? branchName : `refs/heads/${branchName}`
}

/**
 * Extract request ID from a Git ref (e.g. refs/heads/request/req_dev_ec2_abc).
 */
export function extractRequestIdFromBranch(ref: string): string | null {
  if (!ref || typeof ref !== "string") return null
  if (!ref.startsWith(REQUEST_BRANCH_PREFIX)) return null
  const suffix = ref.slice(REQUEST_BRANCH_PREFIX.length).trim()
  if (!suffix) return null
  return suffix
}

/**
 * Extract first request ID mentioned in text (PR title, body, etc.).
 */
export function extractRequestIdFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null
  const match = text.match(REQUEST_ID_IN_TEXT)
  return match ? match[0] : null
}

export type CorrelatePullRequestResult = {
  requestId?: string
  prNumber?: number
  headRef?: string
  headSha?: string
}

/** Payload shape expected by correlatePullRequest (GitHub pull_request / pull_request_review). */
export type PullRequestCorrelationPayload = {
  pull_request?: {
    number?: number
    head?: { ref?: string; sha?: string }
    title?: string
    body?: string | null
  }
  repository?: {
    full_name?: string
    owner?: { login?: string }
    name?: string
  }
}

function parseOwnerRepo(payload: PullRequestCorrelationPayload): { owner: string; repo: string } | null {
  const repo = payload?.repository
  if (!repo) return null
  if (repo.full_name && typeof repo.full_name === "string") {
    const parts = repo.full_name.split("/").filter(Boolean)
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] }
  }
  const owner = repo.owner?.login
  const name = repo.name
  if (owner && name) return { owner, repo: name }
  return null
}

/**
 * Correlate a pull_request webhook payload to a TfPilot request.
 * Order: branch ref (request/req_*) → PR title/body → PR index lookup by owner/repo/prNumber.
 */
export async function correlatePullRequest(
  payload: PullRequestCorrelationPayload
): Promise<CorrelatePullRequestResult> {
  const pr = payload?.pull_request
  if (!pr) return {}

  const prNumber = pr.number
  const headRef = pr.head?.ref
  const headSha = pr.head?.sha

  let requestId: string | null = null
  if (headRef) {
    requestId = extractRequestIdFromBranch(refFromBranch(headRef))
  }
  if (!requestId && (pr.title || pr.body)) {
    requestId =
      extractRequestIdFromText(pr.title ?? "") ?? extractRequestIdFromText(pr.body ?? "")
  }
  if (!requestId && prNumber != null) {
    const ownerRepo = parseOwnerRepo(payload)
    if (ownerRepo) {
      requestId = await getRequestIdByPr(ownerRepo.owner, ownerRepo.repo, prNumber)
    }
  }

  return {
    ...(requestId ? { requestId } : {}),
    ...(prNumber != null ? { prNumber } : {}),
    ...(headRef ? { headRef } : {}),
    ...(headSha ? { headSha } : {}),
  }
}

export type CorrelateWorkflowRunResult = {
  requestId?: string
  headRef?: string
  headSha?: string
}

/** Payload shape for workflow_run event (has workflow_run.head_branch, etc.). */
export type WorkflowRunCorrelationPayload = {
  workflow_run?: {
    head_branch?: string
    display_title?: string | null
    name?: string | null
    head_sha?: string
  }
}

/**
 * Correlate a workflow_run webhook payload to a TfPilot request.
 * Order: head_branch (request/req_*) → display_title → name.
 */
export function correlateWorkflowRun(
  payload: WorkflowRunCorrelationPayload
): CorrelateWorkflowRunResult {
  const run = payload?.workflow_run
  if (!run) return {}

  const headRef = run.head_branch
  const headSha = run.head_sha

  let requestId: string | null = null
  if (headRef) {
    requestId = extractRequestIdFromBranch(refFromBranch(headRef))
  }
  if (!requestId && run.display_title) {
    requestId = extractRequestIdFromText(run.display_title)
  }
  if (!requestId && run.name) {
    requestId = extractRequestIdFromText(run.name)
  }

  return {
    ...(requestId ? { requestId } : {}),
    ...(headRef ? { headRef } : {}),
    ...(headSha ? { headSha } : {}),
  }
}
