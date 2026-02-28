import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { stripPlanOutputToContent } from "@/lib/plan/strip-plan-output"
import { ensureRuns, getCurrentAttemptStrict } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { getRequestIdByRunId } from "@/lib/requests/runIndex"

/**
 * Smoke test (manual): (1) Plan output loads for completed plan. (2) Raw log link works.
 * (3) If plan attempt missing, shows "Plan run not found". (4) API with ?runId=... (fallback) works.
 */

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
  // fallback: return last 120 lines
  const lines = log.trim().split("\n")
  return lines.slice(-120).join("\n")
}

async function fetchJobLogs(token: string, owner: string, repo: string, runId: number): Promise<string> {
  const jobsRes = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
  const jobsJson = (await jobsRes.json()) as { jobs?: Array<{ id: number; name?: string }> }
  const jobId = jobsJson.jobs?.[0]?.id
  if (!jobId) throw new Error("No jobs found for workflow run")

  const logsRes = await gh(token, `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`)
  return await logsRes.text()
}

export async function GET(req: NextRequest) {
  try {
    const requestIdParam = req.nextUrl.searchParams.get("requestId")
    const runIdParam = req.nextUrl.searchParams.get("runId")

    if (!requestIdParam && !runIdParam) {
      return NextResponse.json({ error: "requestId or runId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    let requestId: string
    let match: Awaited<ReturnType<typeof getRequest>> | null
    let runId: number | undefined

    if (requestIdParam) {
      requestId = requestIdParam
      match = await getRequest(requestId).catch(() => null)
      if (!match?.targetOwner || !match?.targetRepo) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 })
      }
      ensureRuns(match as Record<string, unknown>)
      const planAttempt = getCurrentAttemptStrict(match.runs as RunsState, "plan")
      runId = planAttempt?.runId
    } else {
      const runIdParsed = runIdParam ? parseInt(runIdParam, 10) : NaN
      if (isNaN(runIdParsed)) {
        return NextResponse.json({ error: "Invalid runId" }, { status: 400 })
      }
      const resolved = await getRequestIdByRunId("plan", runIdParsed)
      if (!resolved) {
        return NextResponse.json({ error: "Request not found for runId" }, { status: 404 })
      }
      requestId = resolved
      match = await getRequest(requestId).catch(() => null)
      if (!match?.targetOwner || !match?.targetRepo) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 })
      }
      ensureRuns(match as Record<string, unknown>)
      const inAttempts = (match.runs as RunsState)?.plan?.attempts?.some((a) => a.runId === runIdParsed)
      if (!inAttempts) {
        return NextResponse.json({ error: "Plan run not found" }, { status: 404 })
      }
      runId = runIdParsed
    }

    if (runId == null) {
      return NextResponse.json({ error: "Plan run not found" }, { status: 404 })
    }

    const runRes = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/actions/runs/${runId}`)
    const runJson = (await runRes.json()) as { status?: string; conclusion?: string }

    const logText = await fetchJobLogs(token, match.targetOwner, match.targetRepo, runId)
    const planText = stripPlanOutputToContent(extractPlan(logText))

    const rawLogUrl = `https://github.com/${match.targetOwner}/${match.targetRepo}/actions/runs/${runId}`

    return NextResponse.json({
      planText,
      rawLogUrl,
      status: runJson.status,
      conclusion: runJson.conclusion,
    })
  } catch (error) {
    console.error("[api/github/plan-output] error", error)
    return NextResponse.json({ error: "Failed to load plan output" }, { status: 500 })
  }
}
