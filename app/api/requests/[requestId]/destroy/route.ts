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
import { getCurrentAttemptStrict, patchAttemptRunId, persistDispatchAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
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
        const destroyAttempt = getCurrentAttemptStrict(request.runs as RunsState | undefined, "destroy")
        return NextResponse.json({
          ok: true,
          runId: destroyAttempt?.runId,
          url: destroyAttempt?.url,
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

    const planAttempt = getCurrentAttemptStrict(request.runs as RunsState | undefined, "plan")
    const candidateShas = new Set(
      [
        request.mergedSha,
        request.commitSha,
        planAttempt?.headSha,
        (request as { pr?: { headSha?: string } }).pr?.headSha,
      ].filter(Boolean) as string[]
    )
    const branch = request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH
    const destroyAttemptExisting = getCurrentAttemptStrict(request.runs as RunsState | undefined, "destroy")
    const inFlightDestroy =
      destroyAttemptExisting &&
      (destroyAttemptExisting.conclusion == null || destroyAttemptExisting.conclusion === undefined)

    if (inFlightDestroy) {
      // Idempotency: already have an in-flight destroy attempt; do not create another or dispatch again. Try to resolve runId and attach.
      const dispatchTime = destroyAttemptExisting.dispatchedAt
        ? new Date(destroyAttemptExisting.dispatchedAt)
        : new Date()
      const RESOLVE_ATTEMPTS = 12
      const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
      let runIdDestroy: number | undefined
      let urlDestroy: string | undefined
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
            runIdDestroy = result.runId
            urlDestroy = result.url
            break
          }
        } catch {
          /* ignore */
        }
      }
      if (runIdDestroy != null && urlDestroy != null) {
        try {
          await putRunIndex("destroy", runIdDestroy, request.id)
        } catch (err) {
          logWarn("destroy.run_index_write_failed", { ...correlation, requestId: request.id, runId: runIdDestroy, err: String(err) })
        }
        const [updated] = await updateRequest(request.id, (current) => {
          const patched = patchAttemptRunId(current.runs as RunsState, "destroy", destroyAttemptExisting.attempt, {
            runId: runIdDestroy!,
            url: urlDestroy,
          })
          if (!patched) return current
          const cur = current as { cleanupPr?: unknown }
          return {
            ...current,
            runs: patched,
            statusDerivedAt: new Date().toISOString(),
            cleanupPr: cur.cleanupPr ?? { status: "pending" },
            updatedAt: new Date().toISOString(),
          }
        })
        const releasePatch = releaseLock(updated as RequestDocWithLock, holder)
        if (releasePatch) await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
        await logLifecycleEvent({
          requestId: request.id,
          event: "destroy_dispatched",
          actor: session.login,
          source: "api/requests/[requestId]/destroy",
          data: { runId: runIdDestroy, url: urlDestroy, targetRepo: `${request.targetOwner}/${request.targetRepo}` },
        })
        try {
          await archiveRequest(updated)
        } catch (archiveError) {
          console.error("[api/requests/destroy] archive failed", archiveError)
        }
        return NextResponse.json({ ok: true, runId: runIdDestroy, url: urlDestroy, request: updated })
      }
      const current = await getRequest(request.id).catch(() => request)
      const releasePatch = releaseLock(current as RequestDocWithLock, holder)
      if (releasePatch) await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
      return NextResponse.json({ ok: true, runId: undefined, url: undefined, request: current })
    }

    const nowIso = new Date().toISOString()
    const [afterPersist] = await updateRequest(request.id, (current) => {
      const runsPatch = persistDispatchAttempt(current as Record<string, unknown>, "destroy", {
        actor: session.login,
        ref: branch,
      })
      if (process.env.DEBUG_WEBHOOKS === "1") {
        const nextAttempt = ((current.runs as RunsState)?.destroy?.currentAttempt ?? 0) + 1
        console.log("event=destroy.attempt_persisted_without_runid", {
          requestId: request.id,
          attempt: nextAttempt,
          dispatchedAt: runsPatch.updatedAt,
        })
      }
      const cur = current as { cleanupPr?: unknown }
      return {
        ...current,
        ...runsPatch,
        statusDerivedAt: nowIso,
        cleanupPr: cur.cleanupPr ?? { status: "pending" },
        updatedAt: runsPatch.updatedAt,
      }
    })

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

    const RESOLVE_ATTEMPTS = 12
    const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
    let runIdDestroy: number | undefined
    let urlDestroy: string | undefined

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
          runIdDestroy = result.runId
          urlDestroy = result.url
          break
        }
      } catch (err) {
        if (attempt === RESOLVE_ATTEMPTS - 1) {
          logWarn("destroy.resolve_run_failed", { ...correlation, requestId: request.id, attempt: attempt + 1, err: String(err) })
        }
      }
    }

    if (runIdDestroy != null) {
      try {
        await putRunIndex("destroy", runIdDestroy, request.id)
      } catch (err) {
        logWarn("destroy.run_index_write_failed", { ...correlation, requestId: request.id, runId: runIdDestroy, err: String(err) })
      }
    }

    const destroyAttemptAfter = getCurrentAttemptStrict(afterPersist.runs as RunsState, "destroy")
    const [updated] = await updateRequest(request.id, (current) => {
      if (runIdDestroy != null && urlDestroy != null && destroyAttemptAfter != null) {
        const patched = patchAttemptRunId(current.runs as RunsState, "destroy", destroyAttemptAfter.attempt, {
          runId: runIdDestroy,
          url: urlDestroy,
        })
        if (patched) {
          const cur = current as { cleanupPr?: unknown }
          return {
            ...current,
            runs: patched,
            statusDerivedAt: nowIso,
            cleanupPr: cur.cleanupPr ?? { status: "pending" },
            updatedAt: new Date().toISOString(),
          }
        }
      }
      return current
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
        runId: runIdDestroy ?? getCurrentAttemptStrict(updated.runs as RunsState | undefined, "destroy")?.runId,
        url: urlDestroy ?? getCurrentAttemptStrict(updated.runs as RunsState | undefined, "destroy")?.url,
        targetRepo: `${request.targetOwner}/${request.targetRepo}`,
      },
    })

    // Write an archive copy under history/ while keeping the active tombstone
    try {
      await archiveRequest(updated)
    } catch (archiveError) {
      console.error("[api/requests/destroy] archive failed", archiveError)
    }

    return NextResponse.json({ ok: true, runId: runIdDestroy ?? undefined, url: urlDestroy ?? undefined, request: updated })
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
