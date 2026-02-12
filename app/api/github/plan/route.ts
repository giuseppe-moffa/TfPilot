import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { requestId?: string }
    if (!body?.requestId) {
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

    const request = await getRequest(body.requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
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

    await updateRequest(request.id, (current) => ({
      status: "planning",
      workflowRunId: workflowRunId ?? current.workflowRunId,
      planRunId: workflowRunId ?? current.planRunId,
      planRunUrl: workflowRunUrl ?? current.planRunUrl,
      planHeadSha: planHeadSha ?? current.planHeadSha,
      planRun: {
        ...(current.planRun ?? {}),
        runId: workflowRunId ?? current.planRun?.runId,
        url: workflowRunUrl ?? current.planRun?.url,
        headSha: planHeadSha ?? current.planRun?.headSha,
      },
      updatedAt: new Date().toISOString(),
    }))

    return NextResponse.json({ ok: true, workflowRunId, workflowRunUrl })
  } catch (error) {
    console.error("[api/github/plan] error", error)
    return NextResponse.json({ error: "Failed to dispatch plan" }, { status: 500 })
  }
}
