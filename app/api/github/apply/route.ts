import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { githubRequest } from "@/lib/github/rateAware"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
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

    const idemKey = getIdempotencyKey(req) ?? ""
    const now = new Date()
    try {
      const idem = assertIdempotentOrRecord({
        requestDoc: request as { idempotency?: Record<string, { key: string; at: string }> },
        operation: "apply",
        key: idemKey,
        now,
      })
      if (idem.ok === false && idem.mode === "replay") {
        logInfo("idempotency.replay", { ...correlation, requestId: request.id, operation: "apply" })
        return NextResponse.json({ ok: true })
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
        operation: "apply",
        holder,
        now,
      })
      if (lockResult.patch) {
        await updateRequest(request.id, (c) => ({ ...c, ...lockResult.patch, updatedAt: now.toISOString() }))
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
    const applyRef = request.branchName ?? request.targetBase ?? "main"
    if (!owner || !repo) {
      return NextResponse.json({ error: "Request missing target repo info" }, { status: 400 })
    }

    const dispatchBody = {
      ref: applyRef,
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
      const runsJson = await githubRequest<{ workflow_runs?: Array<{ id: number }> }>({
        token,
        key: `gh:wf-runs:${owner}:${repo}:${env.GITHUB_APPLY_WORKFLOW_FILE}:${applyRef}`,
        ttlMs: 15_000,
        path: `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
          applyRef
        )}&per_page=1`,
        context: { route: "github/apply", correlationId: requestId },
      })
      applyRunId = runsJson.workflow_runs?.[0]?.id
      if (applyRunId) {
        applyRunUrl = `https://github.com/${owner}/${repo}/actions/runs/${applyRunId}`
      }
    } catch {
      /* ignore */
    }

    const afterApply = await updateRequest(request.id, (current) => ({
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
    const releasePatch = releaseLock(afterApply as RequestDocWithLock, holder)
    if (releasePatch) {
      await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
    }

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
    return NextResponse.json({ error: "Failed to dispatch apply" }, { status: 500 })
  }
}
