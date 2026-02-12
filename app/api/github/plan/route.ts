import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { requestId?: string }
    if (!body?.requestId) {
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
    const idx = requests.findIndex((r: any) => r.id === body.requestId)
    if (idx === -1) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    const request = requests[idx]
    if (!request.branchName || !request.targetOwner || !request.targetRepo) {
      return NextResponse.json({ error: "Missing branch or repo info" }, { status: 400 })
    }

    await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: request.branchName,
        inputs: {
          request_id: request.id,
          environment: request.environment,
        },
      }),
    })

    let workflowRunId: number | undefined
    let workflowRunUrl: string | undefined
    let planHeadSha: string | undefined

    try {
      const prRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}`)
      const prJson = (await prRes.json()) as { head?: { sha?: string } }
      planHeadSha = prJson.head?.sha
    } catch {
      /* ignore */
    }

    try {
      const runsRes = await gh(
        token,
        `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
          request.branchName
        )}&per_page=1`
      )
      const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
      workflowRunId = runsJson.workflow_runs?.[0]?.id
      if (workflowRunId) {
        workflowRunUrl = `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${workflowRunId}`
      }
    } catch {
      /* ignore */
    }

    requests[idx] = {
      ...request,
      status: "planning",
      workflowRunId: workflowRunId ?? request.workflowRunId,
      planRunId: workflowRunId ?? request.planRunId,
      planRunUrl: workflowRunUrl ?? request.planRunUrl,
      planHeadSha: planHeadSha ?? request.planHeadSha,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(STORAGE_FILE, JSON.stringify(requests, null, 2), "utf8")

    return NextResponse.json({ ok: true, workflowRunId, workflowRunUrl })
  } catch (error) {
    console.error("[api/github/plan] error", error)
    return NextResponse.json({ error: "Failed to dispatch plan" }, { status: 500 })
  }
}
