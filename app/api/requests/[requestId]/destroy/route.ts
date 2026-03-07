import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { archiveRequest, getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
  type PermissionContext,
  type ProjectPermission,
} from "@/lib/auth/permissions"
import { getProjectByKey } from "@/lib/db/projects"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"
import { getCurrentAttemptStrict, patchAttemptRunId, persistDispatchAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { putRunIndex } from "@/lib/requests/runIndex"
import { resolveDestroyRunId } from "@/lib/requests/resolveDestroyRunId"
import { getMissingEnvFields } from "@/lib/requests/requireEnvFields"
import { getRequestOrgId } from "@/lib/db/requestsList"
import type { SessionPayload } from "@/lib/auth/session"

type RequestDocForDestroy = {
  id: string
  org_id?: string
  project_key?: string
  targetOwner?: string
  targetRepo?: string
  targetEnvPath?: string
  targetBase?: string
  environment_key?: string
  environment_slug?: string
  environment_id?: string
  module?: string
  mergedSha?: string
  commitSha?: string
  runs?: RunsState
  pr?: { headSha?: string }
}

export type DestroyRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  getGitHubAccessToken: (req: NextRequest) => Promise<string | null>
  getRequest: (id: string) => Promise<unknown>
  getRequestOrgId: (id: string) => Promise<string | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ id: string; orgId: string } | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  getIdempotencyKey: (req: NextRequest) => string | null
  assertIdempotentOrRecord: (opts: {
    requestDoc: { idempotency?: Record<string, { key: string; at: string }> }
    operation: string
    key: string
    now: Date
  }) => { ok: boolean; mode: string; patch?: { idempotency: Record<string, { key: string; at: string }> } }
  updateRequest: (id: string, fn: (current: unknown) => unknown) => Promise<unknown[]>
}

const realDestroyDeps: DestroyRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getGitHubAccessToken,
  getRequest,
  getRequestOrgId,
  getProjectByKey,
  buildPermissionContext,
  requireProjectPermission,
  getIdempotencyKey,
  assertIdempotentOrRecord,
  updateRequest,
}

export function makeDestroyPOST(deps: DestroyRouteDeps) {
  return async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
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

    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    if (!session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes
    const token = await deps.getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const raw = await deps.getRequest(requestId).catch(() => null)
    if (!raw) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    const request = raw as RequestDocForDestroy
    const resourceOrgId = request.org_id ?? (await deps.getRequestOrgId(requestId))
    if (!resourceOrgId || resourceOrgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const projectKey = request.project_key
    if (!projectKey) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const project = await deps.getProjectByKey(session.orgId, projectKey)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const ctx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(ctx, project.id, "destroy")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Destroy not permitted for your role" }, { status: 403 })
      }
      throw e
    }

    const missing = getMissingEnvFields(request as Record<string, unknown>)
    if (missing.length > 0) {
      logError("destroy.missing_env_fields", new Error(`Request missing: ${missing.join(", ")}`), { ...correlation, requestId: request.id })
      return NextResponse.json(
        { error: "REQUEST_MISSING_ENV_FIELDS", request_id: request.id, missing },
        { status: 409 }
      )
    }

    const idemKey = deps.getIdempotencyKey(req) ?? ""
    const now = new Date()
    let idemPatch: { idempotency: Record<string, { key: string; at: string }> } | null = null
    try {
      const idem = deps.assertIdempotentOrRecord({
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
      if (idem.ok === true && idem.mode === "recorded") idemPatch = idem.patch ?? null
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
      await deps.updateRequest(request.id, (current) => ({ ...(current as Record<string, unknown>), ...(idemPatch as Record<string, unknown>), updatedAt: now.toISOString() }))
    }
    try {
      const lockResult = acquireLock({
        requestDoc: request as { lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string } },
        operation: "destroy",
        holder,
        now,
      })
      if (lockResult.patch) {
        await deps.updateRequest(request.id, (c) => ({ ...(c as Record<string, unknown>), ...(lockResult.patch as Record<string, unknown>), updatedAt: now.toISOString() }))
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

    const envKey = request.environment_key
    const isProd = envKey?.toLowerCase() === "prod"

    // Fire cleanup workflow first so code removal is ready before destroy completes
    const envSlug = request.environment_slug ?? ""
    if (
      env.GITHUB_CLEANUP_WORKFLOW_FILE &&
      request.targetOwner &&
      request.targetRepo &&
      envKey &&
      envSlug !== undefined &&
      request.module
    ) {
      const cleanupInputs = {
        request_id: request.id,
        module: request.module,
        environment_key: envKey,
        environment_slug: envSlug,
        target_base: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
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
        lastActionAt: nowIso,
      }
    })

    const dispatchTime = new Date()

    // Dispatch destroy workflow (destroy_scope=module for single request)
    const dEnvKey = request.environment_key
    const dEnvSlug = request.environment_slug ?? ""
    await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
        inputs: {
          request_id: request.id,
          environment_key: dEnvKey,
          environment_slug: dEnvSlug,
          destroy_scope: "module",
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
    writeAuditEvent(auditWriteDeps, {
      org_id: (request as { org_id?: string }).org_id!,
      actor_login: session.login,
      source: "user",
      event_type: "request_destroy_dispatched",
      entity_type: "request",
      entity_id: request.id,
      request_id: request.id,
      project_key: request.project_key,
      environment_id: request.environment_id,
    }).catch(() => {})

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
}

export const POST = makeDestroyPOST(realDestroyDeps)
