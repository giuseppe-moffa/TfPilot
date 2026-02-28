import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { ensureRuns, getCurrentAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"

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
    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const match = await getRequest(requestId).catch(() => null)
    if (!match?.targetOwner || !match?.targetRepo) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    ensureRuns(match as Record<string, unknown>)
    const runId = getCurrentAttempt(match.runs as RunsState, "apply")?.runId
    if (!runId) {
      return NextResponse.json({ error: "Apply run not found" }, { status: 404 })
    }

    const runRes = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/actions/runs/${runId}`)
    const runJson = (await runRes.json()) as { status?: string; conclusion?: string }

    const logText = await fetchJobLogs(token, match.targetOwner, match.targetRepo, runId)
    const rawLogUrl = `https://github.com/${match.targetOwner}/${match.targetRepo}/actions/runs/${runId}`

    return NextResponse.json({
      applyText: logText,
      rawLogUrl,
      status: runJson.status,
      conclusion: runJson.conclusion,
    })
  } catch (error) {
    console.error("[api/github/apply-output] error", error)
    return NextResponse.json({ error: "Failed to load apply output" }, { status: 500 })
  }
}
