import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
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

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    if (!request.targetOwner || !request.targetRepo || !request.targetEnvPath) {
      return NextResponse.json({ error: "Request missing repo or env info" }, { status: 400 })
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod destroy not allowed for this user" }, { status: 403 })
      }
    }

    // Dispatch destroy workflow
    await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
        inputs: {
          request_id: request.id,
          environment: request.environment,
        },
      }),
    })

    let destroyRunId: number | undefined
    let destroyRunUrl: string | undefined
    try {
      const runsRes = await gh(
        token,
        `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
          request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH
        )}&per_page=1`
      )
      const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
      destroyRunId = runsJson.workflow_runs?.[0]?.id
      if (destroyRunId) {
        destroyRunUrl = `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${destroyRunId}`
      }
    } catch {
      /* ignore run discovery failures */
    }

    const updated = await updateRequest(request.id, (current) => ({
      ...current,
      status: "destroying",
      destroyRun: {
        runId: destroyRunId ?? current.destroyRun?.runId,
        url: destroyRunUrl ?? current.destroyRun?.url,
      },
      updatedAt: new Date().toISOString(),
    }))

    return NextResponse.json({ ok: true, destroyRunId, destroyRunUrl, request: updated })
  } catch (error) {
    console.error("[api/requests/destroy] error", error)
    return NextResponse.json({ error: "Failed to dispatch destroy" }, { status: 500 })
  }
}
