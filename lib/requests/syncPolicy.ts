/**
 * When to run repair (GitHub calls) in /sync.
 * Conservative: only true when UI would be blocked without fresh facts.
 */

type RequestLike = {
  targetOwner?: string
  targetRepo?: string
  branchName?: string
  mergedSha?: string
  pr?: { number?: number }
  github?: {
    pr?: { number?: number }
    workflows?: {
      plan?: { runId?: number; status?: string; conclusion?: string }
      apply?: { runId?: number; status?: string; conclusion?: string }
      destroy?: { runId?: number; status?: string; conclusion?: string }
    }
  }
  planRun?: { runId?: number; status?: string; conclusion?: string }
  applyRun?: { runId?: number; status?: string; conclusion?: string }
  destroyRun?: { runId?: number; status?: string; conclusion?: string }
}

function hasPr(request: RequestLike): boolean {
  const pr = request.github?.pr ?? request.pr
  return Boolean(pr?.number)
}

function hasPlanRun(request: RequestLike): boolean {
  const run = request.github?.workflows?.plan ?? request.planRun
  return Boolean(run?.runId ?? run?.status ?? run?.conclusion)
}

function hasApplyRun(request: RequestLike): boolean {
  const run = request.github?.workflows?.apply ?? request.applyRun
  return Boolean(run?.runId ?? run?.status ?? run?.conclusion)
}

function hasDestroyRun(request: RequestLike): boolean {
  const run = request.github?.workflows?.destroy ?? request.destroyRun
  return Boolean(run?.runId ?? run?.status ?? run?.conclusion)
}

/**
 * True when critical facts are missing and we have enough context to fetch them (UI would be blocked).
 */
export function needsRepair(request: RequestLike | null | undefined): boolean {
  if (!request?.targetOwner || !request?.targetRepo) return false

  // PR missing but we have a branch (request was created with branch) -> need PR metadata
  if (!hasPr(request) && request.branchName) return true

  // Has PR or mergedSha but no workflow run facts -> need runs for lifecycle
  const hasPrOrMerged = hasPr(request) || Boolean(request.mergedSha)
  if (hasPrOrMerged) {
    if (!hasPlanRun(request)) return true
    if (!hasApplyRun(request)) return true
    if (!hasDestroyRun(request)) return true
  }

  return false
}
