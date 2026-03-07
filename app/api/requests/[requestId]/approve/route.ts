import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getRequestOrgId } from "@/lib/db/requestsList"
import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { env } from "@/lib/config/env"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
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
import {
  getIdempotencyKey,
  assertIdempotentOrRecord,
  ConflictError,
  type AssertIdempotentOpts,
} from "@/lib/requests/idempotency"
import type { LifecycleEvent } from "@/lib/logs/lifecycle"
import type { AuditEventInput } from "@/lib/audit/types"
import { logInfo, logWarn } from "@/lib/observability/logger"

type RequestDocForApprove = {
  org_id?: string
  project_key?: string
  targetOwner?: string
  targetRepo?: string
  prNumber?: number
  pr?: { number?: number }
  environment_key?: string
  timeline?: unknown[]
  environment_id?: string
  idempotency?: Record<string, { key: string; at: string }>
}

export type RequestApproveDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  getRequest: (id: string) => Promise<unknown>
  getRequestOrgId: (id: string) => Promise<string | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ id: string; orgId: string } | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  getGitHubAccessToken: (req: NextRequest) => Promise<string | null>
  gh: (token: string, path: string, opts: { method: string; body?: string }) => Promise<unknown>
  getIdempotencyKey: (req: NextRequest) => string | null
  assertIdempotentOrRecord: (opts: import("@/lib/requests/idempotency").AssertIdempotentOpts) => import("@/lib/requests/idempotency").AssertResult | Promise<import("@/lib/requests/idempotency").AssertResult>
  updateRequest: (id: string, fn: (current: unknown) => unknown) => Promise<unknown[]>
  logLifecycleEvent: (entry: LifecycleEvent) => Promise<void>
  writeAuditEvent: (deps: import("@/lib/audit/write").AuditWriteDeps, event: AuditEventInput) => Promise<unknown>
}

const realDeps: RequestApproveDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getRequest,
  getRequestOrgId,
  getProjectByKey,
  buildPermissionContext,
  requireProjectPermission,
  getGitHubAccessToken,
  gh,
  getIdempotencyKey,
  assertIdempotentOrRecord,
  updateRequest,
  logLifecycleEvent,
  writeAuditEvent: (deps, event) => writeAuditEvent(deps, event).catch(() => {}),
}

export function makeRequestApprovePOST(deps: RequestApproveDeps) {
  return async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
    try {
      const { requestId } = await params

      if (!requestId) {
        return NextResponse.json(
          { success: false, error: "Missing requestId" },
          { status: 400 }
        )
      }

      const session = await deps.getSessionFromCookies()
      if (!session) {
        return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
      }
      if (!session.orgId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const archivedRes = await deps.requireActiveOrg(session)
      if (archivedRes) return archivedRes

      const raw = await deps.getRequest(requestId).catch(() => null)
      if (!raw) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const existing = raw as RequestDocForApprove
      const resourceOrgId = existing.org_id ?? (await deps.getRequestOrgId(requestId))
      if (!resourceOrgId || resourceOrgId !== session.orgId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const projectKey = existing.project_key
      if (!projectKey) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const project = await deps.getProjectByKey(session.orgId, projectKey)
      if (!project || project.orgId !== session.orgId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const ctx = await deps.buildPermissionContext(session.login, session.orgId)
      try {
        await deps.requireProjectPermission(ctx, project.id, "approve")
      } catch (e) {
        if (e instanceof PermissionDeniedError) {
          return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
        }
        throw e
      }

      const token = await deps.getGitHubAccessToken(req)
      if (!token) {
        return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
      }

      if (!existing.targetOwner || !existing.targetRepo || !(existing.prNumber ?? existing.pr?.number)) {
        return NextResponse.json({ success: false, error: "Request missing PR info" }, { status: 400 })
      }

      const idemKey = deps.getIdempotencyKey(req) ?? ""
      const now = new Date()
      try {
        const idem = await Promise.resolve(
          deps.assertIdempotentOrRecord({
            requestDoc: existing,
          operation: "approve",
          key: idemKey,
          now,
          })
        ) as { ok: boolean; mode: string; patch?: Record<string, unknown> }
        if (idem.ok === false && idem.mode === "replay") {
          logInfo("idempotency.replay", { requestId, operation: "approve" })
          const updated = await deps.getRequest(requestId)
          return NextResponse.json({ success: true, request: updated ?? existing }, { status: 200 })
        }
        if (idem.ok === true && idem.mode === "recorded" && idem.patch) {
          await deps.updateRequest(requestId, (current) => ({
            ...(current as Record<string, unknown>),
            ...idem.patch,
            updatedAt: now.toISOString(),
          }))
        }
      } catch (err) {
        if (err instanceof ConflictError) {
          logWarn("idempotency.conflict", { requestId, operation: (err as { operation?: string }).operation })
          return NextResponse.json(
            { error: "Conflict", message: `Idempotency key mismatch for operation approve` },
            { status: 409 }
          )
        }
        throw err
      }

      const prNumber = existing.prNumber ?? existing.pr?.number
      try {
        await deps.gh(token, `/repos/${existing.targetOwner}/${existing.targetRepo}/pulls/${prNumber}/reviews`, {
          method: "POST",
          body: JSON.stringify({ event: "APPROVE" }),
        })
      } catch (_err: unknown) {
        return NextResponse.json({ success: false, error: "Failed to submit approval to GitHub" }, { status: 500 })
      }

      const nowIso = new Date().toISOString()
      const nextTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : []
      nextTimeline.push({
        step: "Approved",
        status: "Complete",
        message: "Request approved and ready for merge",
        at: nowIso,
      })

      const [updated] = await deps.updateRequest(requestId, (current) => ({
        ...(current as Record<string, unknown>),
        approval: {
          approved: true,
          approvedAt: nowIso,
          approvers: (current as { approval?: { approvers?: string[] } }).approval?.approvers?.includes(session.login)
            ? (current as { approval: { approvers: string[] } }).approval.approvers
            : [...((current as { approval?: { approvers?: string[] } }).approval?.approvers ?? []), session.login],
        },
        statusDerivedAt: nowIso,
        updatedAt: nowIso,
        lastActionAt: nowIso,
        timeline: nextTimeline,
      })) as unknown[]

      await deps.logLifecycleEvent({
        requestId,
        event: "request_approved",
        actor: session.login,
        source: "api/requests/[requestId]/approve",
        data: {
          prNumber,
          targetRepo: `${existing.targetOwner}/${existing.targetRepo}`,
        },
      })

      await deps.writeAuditEvent(auditWriteDeps, {
        org_id: session.orgId!,
        actor_login: session.login,
        source: "user",
        event_type: "request_approved",
        entity_type: "request",
        entity_id: requestId,
        request_id: requestId,
        project_key: existing.project_key,
        environment_id: existing.environment_id,
      })

      return NextResponse.json({ success: true, request: updated }, { status: 200 })
    } catch (error) {
      console.error("[api/requests/approve] error", error)
      return NextResponse.json(
        { success: false, error: "Failed to approve request" },
        { status: 500 }
      )
    }
  }
}

export const POST = makeRequestApprovePOST(realDeps)

export async function GET() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}
