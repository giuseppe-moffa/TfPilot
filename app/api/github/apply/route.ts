import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError } from "@/lib/observability/logger"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"

export async function POST(req: NextRequest) {
  const start = Date.now()
  const correlation = withCorrelation(req, {})
  try {
    const body = (await req.json()) as { requestId?: string }
    if (!body?.requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role !== "approver" && role !== "admin") {
      return NextResponse.json({ error: "Apply not permitted for your role" }, { status: 403 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const request = await getRequest(body.requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    if (request.status !== "merged") {
      return NextResponse.json({ error: "Request must be merged before apply" }, { status: 400 })
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod apply not allowed for this user" }, { status: 403 })
      }
    }

    const owner = request.targetOwner
    const repo = request.targetRepo
    const base = request.targetBase ?? "main"
    if (!owner || !repo) {
      return NextResponse.json({ error: "Request missing target repo info" }, { status: 400 })
    }

    const dispatchBody = {
      ref: base,
      inputs: {
        request_id: request.id,
        environment: request.environment ?? "dev",
      },
    }

    await gh(token, `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify(dispatchBody),
    })

    let applyRunId: number | undefined
    let applyRunUrl: string | undefined
    try {
      const runsRes = await gh(
        token,
        `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
        base
      )}&per_page=1`
      )
      const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
      applyRunId = runsJson.workflow_runs?.[0]?.id
      if (applyRunId) {
        applyRunUrl = `https://github.com/${owner}/${repo}/actions/runs/${applyRunId}`
      }
    } catch {
      /* ignore */
    }

    await updateRequest(request.id, (current) => ({
      applyTriggeredAt: new Date().toISOString(),
      applyRunId: applyRunId ?? current.applyRunId,
      applyRunUrl: applyRunUrl ?? current.applyRunUrl,
      applyRun: {
        ...(current.applyRun ?? {}),
        runId: applyRunId ?? current.applyRun?.runId,
        url: applyRunUrl ?? current.applyRun?.url,
      },
      updatedAt: new Date().toISOString(),
    }))

    await logLifecycleEvent({
      requestId: request.id,
      event: "apply_dispatched",
      actor: session.login,
      source: "api/github/apply",
      data: {
        applyRunId,
        applyRunUrl,
        targetRepo: `${owner}/${repo}`,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError("github.dispatch_failed", error, { ...correlation, duration_ms: Date.now() - start })
    return NextResponse.json({ error: "Failed to dispatch apply" }, { status: 500 })
  }
}
