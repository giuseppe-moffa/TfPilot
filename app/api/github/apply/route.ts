import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getSessionFromCookies } from "@/lib/auth/session"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"
import { buildWorkflowDispatchPatch } from "@/lib/requests/persistWorkflowDispatch"
import { putRunIndex } from "@/lib/requests/runIndex"
import { resolveApplyRunId } from "@/lib/requests/resolveApplyRunId"

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
        const current = await getRequest(request.id).catch(() => null)
        return NextResponse.json({ ok: true, request: current ?? request })
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
    const isMerged =
      deriveLifecycleStatus(request) === "merged" ||
      request.pr?.merged === true ||
      !!(request as { mergedSha?: string }).mergedSha
    if (!isMerged) {
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

    const dispatchTime = new Date()
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

    const candidateShas = new Set(
      [
        (request as { mergedSha?: string }).mergedSha,
        (request as { commitSha?: string }).commitSha,
      ].filter(Boolean) as string[]
    )

    const RESOLVE_ATTEMPTS = 12
    const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
    let applyRunId: number | undefined
    let applyRunUrl: string | undefined

    for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]))
      }
      try {
        const result = await resolveApplyRunId({
          token,
          owner,
          repo,
          workflowFile: env.GITHUB_APPLY_WORKFLOW_FILE,
          branch: applyRef,
          requestId: request.id,
          dispatchTime,
          candidateShas,
          logContext: { route: "github/apply", correlationId: correlation.correlationId ?? request.id },
        })
        if (result) {
          applyRunId = result.runId
          applyRunUrl = result.url
          break
        }
      } catch (err) {
        if (attempt === RESOLVE_ATTEMPTS - 1) {
          logWarn("apply.resolve_run_failed", {
            ...correlation,
            requestId: request.id,
            attempt: attempt + 1,
            err: String(err),
          })
        }
      }
    }

    if (applyRunId != null) {
      try {
        await putRunIndex("apply", applyRunId, request.id)
      } catch (err) {
        logWarn("apply.run_index_write_failed", {
          ...correlation,
          requestId: request.id,
          runId: applyRunId,
          err: String(err),
        })
      }
    }

    const nowIso = new Date().toISOString()
    const [afterApply] = await updateRequest(request.id, (current) => {
      const cur = current as { github?: Record<string, unknown>; applyRun?: { runId?: number; url?: string } }
      const runId = applyRunId ?? undefined
      const runUrl = applyRunUrl ?? undefined
      const patch =
        runId != null
          ? buildWorkflowDispatchPatch(current as Record<string, unknown>, "apply", runId, runUrl)
          : {}
      const patchGithub = (patch as { github?: Record<string, unknown> }).github ?? {}
      const applyPayload =
        runId != null
          ? { runId, url: runUrl, status: "in_progress" as const }
          : { status: "queued" as const }
      return {
        ...current,
        ...patch,
        applyTriggeredAt: (patchGithub.applyTriggeredAt as string) ?? nowIso,
        applyRunId: runId ?? undefined,
        applyRunUrl: runUrl ?? undefined,
        github: {
          ...cur.github,
          ...patchGithub,
          applyTriggeredAt: (patchGithub.applyTriggeredAt as string) ?? nowIso,
          workflows: {
            ...(cur.github?.workflows ?? {}),
            ...(patchGithub.workflows ?? {}),
            apply:
              runId != null
                ? { runId, url: runUrl, status: "in_progress" }
                : { status: "queued" },
          },
        },
        applyRun: { ...applyPayload },
        updatedAt: nowIso,
      }
    })
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

    return NextResponse.json({ ok: true, request: afterApply })
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
