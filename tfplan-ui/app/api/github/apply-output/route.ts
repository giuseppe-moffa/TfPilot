import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

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
    const runId = match?.applyRun?.runId ?? match?.applyRunId
    if (!match || !runId || !match.targetOwner || !match.targetRepo) {
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
