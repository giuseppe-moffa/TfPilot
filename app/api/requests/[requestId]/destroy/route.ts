import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { archiveRequest, getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"
import { getEnvTargetFile, getModuleType } from "@/lib/infra/moduleType"
import { buildWorkflowDispatchPatch } from "@/lib/requests/persistWorkflowDispatch"
import { putRunIndex } from "@/lib/requests/runIndex"
import { resolveDestroyRunId } from "@/lib/requests/resolveDestroyRunId"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const start = Date.now()
  const correlation = withCorrelation(req, {})
  const holder = correlation.correlationId
  let requestId: string | undefined
  try {
    const p = await params
    requestId = p.requestId
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role !== "admin") {
      return NextResponse.json({ error: "Destroy not permitted for your role" }, { status: 403 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const idemKey = getIdempotencyKey(req) ?? ""
    const now = new Date()
    let idemPatch: { idempotency: Record<string, { key: string; at: string }> } | null = null
    try {
      const idem = assertIdempotentOrRecord({
        requestDoc: request as { idempotency?: Record<string, { key: string; at: string }> },
        operation: "destroy",
        key: idemKey,
        now,
      })
      if (idem.ok === false && idem.mode === "replay") {
        logInfo("idempotency.replay", { ...correlation, requestId: request.id, operation: "destroy" })
        return NextResponse.json({
          ok: true,
          destroyRunId: (request as { destroyRun?: { runId?: number } }).destroyRun?.runId,
          destroyRunUrl: (request as { destroyRun?: { url?: string } }).destroyRun?.url,
          request,
        })
      }
      if (idem.ok === true && idem.mode === "recorded") idemPatch = idem.patch
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

    if (idemPatch) {
      await updateRequest(request.id, (current) => ({ ...current, ...idemPatch, updatedAt: now.toISOString() }))
    }
    try {
      const lockResult = acquireLock({
        requestDoc: request as { lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string } },
        operation: "destroy",
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

    if (!request.targetOwner || !request.targetRepo || !request.targetEnvPath) {
      return NextResponse.json({ error: "Request missing repo or env info" }, { status: 400 })
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod destroy not allowed for this user" }, { status: 403 })
      }
    }

    // Additional prod destroy allowlist check (separate from general prod access)
    if (isProd && env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.includes(session.login)) {
        await logLifecycleEvent({
          requestId: request.id,
          event: "destroy_blocked",
          actor: session.login,
          source: "api/requests/[requestId]/destroy",
          data: {
            reason: "not_in_destroy_prod_allowlist",
            environment: request.environment,
          },
        })
        return NextResponse.json({ error: "You're not allowed to destroy prod requests" }, { status: 403 })
      }
    }

    // Fire cleanup PR workflow first so code removal is ready before destroy completes
    if (env.GITHUB_CLEANUP_WORKFLOW_FILE && request.targetOwner && request.targetRepo) {
      // Use stored targetFiles when present; otherwise derive from module + env path (e.g. old requests or any missing targetFiles)
      const targetFiles = request.targetFiles ?? []
      const cleanupPaths =
        targetFiles.length > 0
          ? targetFiles.join(",")
          : request.targetEnvPath && request.module
            ? getEnvTargetFile(request.targetEnvPath, getModuleType(request.module))
            : ""
      const cleanupInputs = {
        request_id: request.id,
        environment: request.environment ?? "dev",
        target_base: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
        cleanup_paths: cleanupPaths,
        target_env_path: request.targetEnvPath ?? "",
        auto_merge: isProd ? "false" : "true",
      }
      gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_CLEANUP_WORKFLOW_FILE}/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          ref: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
          inputs: cleanupInputs,
        }),
      }).catch((err) => {
        console.error("[api/requests/destroy] cleanup workflow dispatch failed", err)
      })
    }

    const dispatchTime = new Date()

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

    logInfo("destroy.dispatch", {
      ...correlation,
      requestId: request.id,
      dispatchTime: dispatchTime.toISOString(),
      route: "requests/[requestId]/destroy",
    })

    const candidateShas = new Set(
      [
        request.mergedSha,
        request.commitSha,
        (request as { planRun?: { headSha?: string } }).planRun?.headSha,
        (request as { pr?: { headSha?: string } }).pr?.headSha,
      ].filter(Boolean) as string[]
    )
    const branch = request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH

    const RESOLVE_ATTEMPTS = 12
    const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
    let destroyRunId: number | undefined
    let destroyRunUrl: string | undefined

    for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]))
      }
      try {
        const result = await resolveDestroyRunId({
          token,
          owner: request.targetOwner,
          repo: request.targetRepo,
          workflowFile: env.GITHUB_DESTROY_WORKFLOW_FILE,
          branch,
          requestId: request.id,
          dispatchTime,
          candidateShas,
          requestIdForName: request.id,
          logContext: { route: "requests/[requestId]/destroy", correlationId: correlation.correlationId ?? request.id },
        })
        if (result) {
          destroyRunId = result.runId
          destroyRunUrl = result.url
          break
        }
      } catch (err) {
        if (attempt === RESOLVE_ATTEMPTS - 1) {
          logWarn("destroy.resolve_run_failed", { ...correlation, requestId: request.id, attempt: attempt + 1, err: String(err) })
        }
      }
    }

    if (destroyRunId != null) {
      try {
        await putRunIndex("destroy", destroyRunId, request.id)
      } catch (err) {
        logWarn("destroy.run_index_write_failed", { ...correlation, requestId: request.id, runId: destroyRunId, err: String(err) })
      }
    }

    const nowIso = new Date().toISOString()
    const dispatchTimeIso = dispatchTime.toISOString()

    const [updated] = await updateRequest(request.id, (current) => {
      const cur = current as { github?: Record<string, unknown>; destroyRun?: { runId?: number; url?: string; status?: string }; cleanupPr?: unknown }
      const runId = destroyRunId ?? cur.destroyRun?.runId
      const runUrl = destroyRunUrl ?? cur.destroyRun?.url
      const patch =
        runId != null
          ? buildWorkflowDispatchPatch(current as Record<string, unknown>, "destroy", runId, runUrl)
          : {}
      const patchGithub = (patch as { github?: Record<string, unknown> }).github ?? {}
      return {
        ...current,
        ...(idemPatch ?? {}),
        ...patch,
        statusDerivedAt: nowIso,
        github: {
          ...cur.github,
          ...patchGithub,
          destroyTriggeredAt: dispatchTimeIso,
          workflows: {
            ...(cur.github?.workflows ?? {}),
            ...(patchGithub.workflows ?? {}),
            ...(runId != null ? { destroy: { runId, url: runUrl ?? cur.destroyRun?.url, status: "in_progress" } } : {}),
          },
        },
        destroyRun:
          runId != null ? { runId, url: runUrl ?? cur.destroyRun?.url, status: "in_progress" as const } : { ...cur.destroyRun },
        cleanupPr: cur.cleanupPr ?? { status: "pending" },
        updatedAt: nowIso,
      }
    })
    const releasePatch = releaseLock(updated as RequestDocWithLock, holder)
    if (releasePatch) {
      await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
    }

    await logLifecycleEvent({
      requestId: request.id,
      event: "destroy_dispatched",
      actor: session.login,
      source: "api/requests/[requestId]/destroy",
      data: {
        destroyRunId: destroyRunId ?? request.destroyRun?.runId,
        destroyRunUrl: destroyRunUrl ?? request.destroyRun?.url,
        targetRepo: `${request.targetOwner}/${request.targetRepo}`,
      },
    })

    // Write an archive copy under history/ while keeping the active tombstone
    try {
      await archiveRequest(updated)
    } catch (archiveError) {
      console.error("[api/requests/destroy] archive failed", archiveError)
    }

    return NextResponse.json({ ok: true, destroyRunId, destroyRunUrl, request: updated })
  } catch (error) {
    logError("github.dispatch_failed", error, { ...correlation, requestId, duration_ms: Date.now() - start })
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
    return NextResponse.json({ error: "Failed to dispatch destroy" }, { status: 500 })
  }
}
