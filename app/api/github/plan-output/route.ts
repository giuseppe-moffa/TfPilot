import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

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
    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const raw = await readFile(STORAGE_FILE, "utf8").catch(() => "[]")
    const requests = JSON.parse(raw)
    if (!Array.isArray(requests)) {
      return NextResponse.json({ error: "No requests found" }, { status: 404 })
    }
    const match = requests.find((r: any) => r.id === requestId)
    const runId = match?.planRun?.runId ?? match?.planRunId
    if (!match || !runId || !match.targetOwner || !match.targetRepo) {
      return NextResponse.json({ error: "Plan run not found" }, { status: 404 })
    }

    const runRes = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/actions/runs/${runId}`)
    const runJson = (await runRes.json()) as { status?: string; conclusion?: string }

    const logText = await fetchJobLogs(token, match.targetOwner, match.targetRepo, runId)
    const planText = extractPlan(logText)

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
