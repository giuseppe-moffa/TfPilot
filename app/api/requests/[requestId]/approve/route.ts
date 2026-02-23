import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
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

    const token = await getGitHubAccessToken(_req as any)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    if (!existing.targetOwner || !existing.targetRepo || !(existing.prNumber ?? existing.pr?.number)) {
      return NextResponse.json({ success: false, error: "Request missing PR info" }, { status: 400 })
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

    const now = new Date().toISOString()
    const nextTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : []
    nextTimeline.push({
      step: "Approved",
      status: "Complete",
      message: "Request approved and ready for merge",
      at: now,
    })

    const updated = await updateRequest(requestId, (current) => ({
      ...current,
      approval: { approved: true, approvers: current.approval?.approvers ?? [] },
      statusDerivedAt: now,
      updatedAt: now,
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
