/**
 * Resolve drift-plan v2 workflow runId after workflow_dispatch.
 * Lists runs and returns the earliest run created after dispatch.
 */

import { gh } from "@/lib/github/client"

const CREATED_AT_TOLERANCE_MS = 5_000

export type ResolveWorkspaceDriftRunIdParams = {
  token: string
  owner: string
  repo: string
  workflowFile: string
  branch: string
  dispatchTime: Date
}

export type ResolveWorkspaceDriftRunIdResult = { runId: number; url: string } | null

type WorkflowRunRow = {
  id: number
  created_at?: string
  head_branch?: string
  html_url?: string
}

export async function resolveWorkspaceDriftRunId(
  params: ResolveWorkspaceDriftRunIdParams
): Promise<ResolveWorkspaceDriftRunIdResult> {
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

  const run = candidates[0]
  if (!run) return null

  const url = run.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${run.id}`
  return { runId: run.id, url }
}
