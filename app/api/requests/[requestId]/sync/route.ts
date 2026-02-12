import { NextRequest, NextResponse } from "next/server"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { deriveStatus } from "@/lib/requests/status"
import { getRequest, saveRequest } from "@/lib/storage/requestsStore"
import { env } from "@/lib/config/env"

function extractPlan(log: string) {
  const lower = log.toLowerCase()
  const planIdx = lower.indexOf("terraform plan")
  if (planIdx !== -1) {
    const summaryIdx = lower.lastIndexOf("plan:", lower.length)
    if (summaryIdx !== -1 && summaryIdx > planIdx) {
      const endLine = log.indexOf("\n", summaryIdx + 5)
      return log.slice(planIdx, endLine === -1 ? undefined : endLine + 1)
    }
    return log.slice(planIdx)
  }
  const lines = log.trim().split("\n")
  return lines.slice(-120).join("\n")
}

async function fetchJobLogs(token: string, owner: string, repo: string, runId: number): Promise<string | null> {
  try {
    const jobsRes = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
    const jobsJson = (await jobsRes.json()) as { jobs?: Array<{ id: number }> }
    const jobId = jobsJson.jobs?.[0]?.id
    if (!jobId) return null
    const logsRes = await gh(token, `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`)
    return await logsRes.text()
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    const token = await getGitHubAccessToken(req)
    if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })

    const request = await getRequest(requestId).catch(() => null)
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })

    if (!request.targetOwner || !request.targetRepo) {
      return NextResponse.json({ error: "Request missing repo info" }, { status: 400 })
    }

    // hydrate PR struct if only prNumber/prUrl were stored
    if (!request.pr && request.prNumber) {
      request.pr = { number: request.prNumber, url: request.prUrl }
    }

    if (request.pr?.number) {
      const prRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}`)
      const prJson = (await prRes.json()) as { merged?: boolean; head?: { sha?: string }; state?: string; html_url?: string; number?: number; title?: string }
      request.pr = {
        number: prJson.number ?? request.pr.number,
        url: prJson.html_url ?? request.pr.url,
        merged: prJson.merged,
        headSha: prJson.head?.sha,
        open: prJson.state === "open",
      }
      // keep legacy top-level fields in sync for UI links
      request.prNumber = request.pr.number
      request.prUrl = request.pr.url
      request.pullRequest = {
        number: request.pr.number,
        url: request.pr.url,
        title: prJson.title ?? request.pullRequest?.title,
        merged: request.pr.merged,
        headSha: request.pr.headSha,
        open: request.pr.open,
      }

      try {
        const revRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}/reviews`)
        const reviews = (await revRes.json()) as Array<{ user?: { login?: string }; state?: string }>
        const latest = new Map<string, string>()
        for (const r of reviews) {
          const login = r.user?.login
          if (!login) continue
          latest.set(login, r.state ?? "")
        }
        const approvers: string[] = []
        let approved = false
        for (const [login, state] of latest.entries()) {
          if (state === "APPROVED") {
            approvers.push(login)
            approved = true
          }
          if (state === "CHANGES_REQUESTED") {
            approved = false
          }
        }
        request.approval = { approved, approvers }
      } catch {
        /* ignore approvals */
      }
    }

    // If we never captured a plan run ID (GitHub dispatch lag), try to discover it by branch/workflow
    if (!request.planRun?.runId && request.branchName && env.GITHUB_PLAN_WORKFLOW_FILE) {
      try {
        const runsRes = await gh(
          token,
          `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
            request.branchName
          )}&per_page=3`
        )
        const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }> }
        const firstRun = runsJson.workflow_runs?.[0]
        if (firstRun?.id) {
          request.planRun = {
            runId: firstRun.id,
            status: firstRun.status,
            conclusion: firstRun.conclusion,
            headSha: firstRun.head_sha,
            url: firstRun.html_url,
          }
        }
      } catch {
        /* ignore discovery failures */
      }
    }

    if (request.planRun?.runId) {
      try {
        const runRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.planRun.runId}`)
        const runJson = (await runRes.json()) as { status?: string; conclusion?: string; head_sha?: string; html_url?: string }
        request.planRun = {
          ...request.planRun,
          status: runJson.status ?? request.planRun.status,
          conclusion: runJson.conclusion ?? request.planRun.conclusion,
          headSha: runJson.head_sha ?? request.planRun.headSha,
          url: runJson.html_url ?? request.planRun.url,
        }

        const logs = await fetchJobLogs(token, request.targetOwner, request.targetRepo, request.planRun.runId)
        if (logs) {
          const planText = extractPlan(logs)
          request.plan = {
            ...(request.plan ?? {}),
            output: planText ?? request.plan?.output,
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (request.applyRun?.runId) {
      try {
        const runRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.applyRun.runId}`)
        const runJson = (await runRes.json()) as { status?: string; conclusion?: string; html_url?: string }
        request.applyRun = {
          ...request.applyRun,
          status: runJson.status ?? request.applyRun.status,
          conclusion: runJson.conclusion ?? request.applyRun.conclusion,
          url: runJson.html_url ?? request.applyRun.url,
        }
      } catch {
        /* ignore */
      }
    }

    const derived = deriveStatus({
      pr: request.pr,
      planRun: request.planRun,
      applyRun: request.applyRun,
      approval: request.approval,
    })
    request.status = derived.status
    request.reason = derived.reason
    request.statusDerivedAt = new Date().toISOString()
    request.updatedAt = new Date().toISOString()

    await saveRequest(request)

    return NextResponse.json({ ok: true, request })
  } catch (error) {
    console.error("[api/requests/sync] error", error)
    return NextResponse.json({ error: "Failed to sync request" }, { status: 500 })
  }
}
