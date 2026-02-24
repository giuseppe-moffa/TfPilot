import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { githubRequest } from "@/lib/github/rateAware"
import { env } from "@/lib/config/env"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"

export async function POST(req: NextRequest) {
  const start = Date.now()
  const correlation = withCorrelation(req, {})
  const holder = correlation.correlationId
  let requestId: string | undefined
  try {
    const body = (await req.json()) as { requestId?: string }
    requestId = body?.requestId
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

    const idemKey = getIdempotencyKey(req) ?? ""
    const now = new Date()
    try {
      const idem = assertIdempotentOrRecord({
        requestDoc: request as { idempotency?: Record<string, { key: string; at: string }> },
        operation: "plan",
        key: idemKey,
        now,
      })
      if (idem.ok === false && idem.mode === "replay") {
        logInfo("idempotency.replay", { ...correlation, requestId: request.id, operation: "plan" })
        const planRun = (request as { planRun?: { runId?: number; url?: string } }).planRun
        return NextResponse.json({
          ok: true,
          workflowRunId: planRun?.runId,
          workflowRunUrl: planRun?.url,
        })
      }
      if (idem.ok === true && idem.mode === "recorded") {
        await updateRequest(request.id, (current) => ({ ...current, ...idem.patch, updatedAt: now.toISOString() }))
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        logWarn("idempotency.conflict", { ...correlation, requestId: request.id, operation: err.operation })
        return NextResponse.json(
          { error: "Conflict", message: `Idempotency key mismatch for operation ${err.operation}` },
          { status: 409 }
        )
      }
      throw err
    }
    try {
      const lockResult = acquireLock({
        requestDoc: request as { lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string } },
        operation: "plan",
        holder,
        now,
      })
      if (lockResult.patch) {
        await updateRequest(request.id, (current) => ({ ...current, ...lockResult.patch, updatedAt: now.toISOString() }))
      }
    } catch (lockErr) {
      if (lockErr instanceof LockConflictError) {
        return NextResponse.json(
          { error: "Locked", message: "Request is currently locked by another operation" },
          { status: 409 }
        )
      }
      throw lockErr
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod plan not allowed for this user" }, { status: 403 })
      }
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
      const prJson = await githubRequest<{ head?: { sha?: string } }>({
        token,
        key: `gh:pr:${request.targetOwner}:${request.targetRepo}:${request.prNumber}`,
        ttlMs: 30_000,
        path: `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}`,
        context: { route: "github/plan", correlationId: requestId },
      })
      planHeadSha = prJson.head?.sha
    } catch {
      /* ignore */
    }

    try {
      const runsJson = await githubRequest<{ workflow_runs?: Array<{ id: number }> }>({
        token,
        key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${env.GITHUB_PLAN_WORKFLOW_FILE}:${request.branchName}`,
        ttlMs: 15_000,
        path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
          request.branchName
        )}&per_page=1`,
        context: { route: "github/plan", correlationId: requestId },
      })
      workflowRunId = runsJson.workflow_runs?.[0]?.id
      if (workflowRunId) {
        workflowRunUrl = `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${workflowRunId}`
      }
    } catch {
      /* ignore */
    }

    const afterPlan = await updateRequest(request.id, (current) => ({
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
    const releasePatch = releaseLock(afterPlan as RequestDocWithLock, holder)
    if (releasePatch) {
      await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
    }

    return NextResponse.json({ ok: true, workflowRunId, workflowRunUrl })
  } catch (error) {
    logError("github.dispatch_failed", error, { ...correlation, duration_ms: Date.now() - start })
    try {
      if (requestId && holder) {
        const current = await getRequest(requestId).catch(() => null)
        if (current) {
          const releasePatch = releaseLock(current as RequestDocWithLock, holder)
          if (releasePatch) await updateRequest(requestId, (c) => ({ ...c, ...releasePatch }))
        }
      }
    } catch {
      /* best-effort release */
    }
    return NextResponse.json({ error: "Failed to dispatch plan" }, { status: 500 })
  }
}
