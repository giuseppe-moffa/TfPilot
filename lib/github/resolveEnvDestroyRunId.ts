/**
 * Resolve env destroy workflow runId after workflow_dispatch.
 * Skips runs already claimed by a request (request destroy) via run index.
 */

import { gh } from "@/lib/github/client"
import { getRequestIdByRunId } from "@/lib/requests/runIndex"

const CREATED_AT_TOLERANCE_MS = 5_000

export type ResolveEnvDestroyRunIdParams = {
  token: string
  owner: string
  repo: string
  workflowFile: string
  branch: string
  dispatchTime: Date
}

export type ResolveEnvDestroyRunIdResult = { runId: number; url: string } | null

type WorkflowRunRow = {
  id: number
  created_at?: string
  head_branch?: string
  html_url?: string
}

export async function resolveEnvDestroyRunId(
  params: ResolveEnvDestroyRunIdParams
): Promise<ResolveEnvDestroyRunIdResult> {
  const { token, owner, repo, workflowFile, branch, dispatchTime } = params

  const path = `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?branch=${encodeURIComponent(
    branch
  )}&per_page=30`
  const res = await gh(token, path)
  const data = (await res.json()) as { workflow_runs?: WorkflowRunRow[] }
  const runs = data.workflow_runs ?? []

  const dispatchTs = dispatchTime.getTime()
  const minCreatedTs = dispatchTs - CREATED_AT_TOLERANCE_MS

  const candidates = runs
    .filter((r) => {
      const created = r.created_at ? Date.parse(r.created_at) : NaN
      if (Number.isNaN(created) || created < minCreatedTs) return false
      if (r.head_branch != null && r.head_branch !== branch) return false
      return true
    })
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return ta - tb
    })

  for (const run of candidates) {
    // Skip runs claimed by a request (those are request destroy runs)
    const existingRequestId = await getRequestIdByRunId("destroy", run.id)
    if (existingRequestId != null) continue

    const url = run.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${run.id}`
    return { runId: run.id, url }
  }

  return null
}
