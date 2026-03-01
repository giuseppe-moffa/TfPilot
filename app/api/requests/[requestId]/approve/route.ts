import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { logInfo, logWarn } from "@/lib/observability/logger"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params

    if (!requestId) {
      return NextResponse.json(
        { success: false, error: "Missing requestId" },
        { status: 400 }
      )
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role !== "approver" && role !== "admin") {
      return NextResponse.json({ success: false, error: "Approval not permitted for your role" }, { status: 403 })
    }

    const existing = await getRequest(requestId).catch(() => null)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    if (!existing.targetOwner || !existing.targetRepo || !(existing.prNumber ?? existing.pr?.number)) {
      return NextResponse.json({ success: false, error: "Request missing PR info" }, { status: 400 })
    }

    const idemKey = getIdempotencyKey(req) ?? ""
    const now = new Date()
    try {
      const idem = assertIdempotentOrRecord({
        requestDoc: existing as { idempotency?: Record<string, { key: string; at: string }> },
        operation: "approve",
        key: idemKey,
        now,
      })
      if (idem.ok === false && idem.mode === "replay") {
        logInfo("idempotency.replay", { requestId, operation: "approve" })
        const updated = await getRequest(requestId)
        return NextResponse.json({ success: true, request: updated ?? existing }, { status: 200 })
      }
      if (idem.ok === true && idem.mode === "recorded") {
        await updateRequest(requestId, (current) => ({ ...current, ...idem.patch, updatedAt: now.toISOString() }))
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        logWarn("idempotency.conflict", { requestId, operation: err.operation })
        return NextResponse.json(
          { error: "Conflict", message: `Idempotency key mismatch for operation ${err.operation}` },
          { status: 409 }
        )
      }
      throw err
    }

    const prNumber = existing.prNumber ?? existing.pr?.number
    try {
      await gh(token, `/repos/${existing.targetOwner}/${existing.targetRepo}/pulls/${prNumber}/reviews`, {
        method: "POST",
        body: JSON.stringify({ event: "APPROVE" }),
      })
    } catch (_err: unknown) {
      return NextResponse.json({ success: false, error: "Failed to submit approval to GitHub" }, { status: 500 })
    }

    const isProd = existing.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ success: false, error: "Prod approvals not allowed for this user" }, { status: 403 })
      }
    }

    const nowIso = new Date().toISOString()
    const existingApprovers = existing.approval?.approvers ?? []
    const approvers =
      existingApprovers.includes(session.login)
        ? existingApprovers
        : [...existingApprovers, session.login]
    const nextTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : []
    nextTimeline.push({
      step: "Approved",
      status: "Complete",
      message: "Request approved and ready for merge",
      at: nowIso,
    })

    const [updated] = await updateRequest(requestId, (current) => ({
      ...current,
      approval: {
        approved: true,
        approvedAt: nowIso,
        approvers: current.approval?.approvers?.includes(session.login)
          ? current.approval.approvers
          : [...(current.approval?.approvers ?? []), session.login],
      },
      statusDerivedAt: nowIso,
      updatedAt: nowIso,
      timeline: nextTimeline,
    }))

    await logLifecycleEvent({
      requestId,
      event: "request_approved",
      actor: session.login,
      source: "api/requests/[requestId]/approve",
      data: {
        prNumber,
        targetRepo: `${existing.targetOwner}/${existing.targetRepo}`,
      },
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
