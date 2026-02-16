import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    const body = (await req.json()) as {
      runId?: number
      runUrl?: string
      hasDrift?: boolean
      summary?: string
    }

    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    // Simple auth check - verify GitHub token in header (basic validation)
    const authHeader = req.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    // Get previous drift status for transition detection
    const previousStatus = request.drift?.status ?? "none"
    const hasDrift = body.hasDrift === true
    const newStatus = hasDrift ? "detected" : "none"

    // Always log drift_check_started
    await logLifecycleEvent({
      requestId: request.id,
      event: "drift_check_started",
      actor: "system",
      source: "workflow/drift-plan",
      data: {
        runId: body.runId,
        runUrl: body.runUrl,
      },
    })

    // Log transition events only on state change
    if (previousStatus === "none" && newStatus === "detected") {
      await logLifecycleEvent({
        requestId: request.id,
        event: "drift_detected",
        actor: "system",
        source: "workflow/drift-plan",
        data: {
          runId: body.runId,
          runUrl: body.runUrl,
          summary: body.summary,
        },
      })
    } else if (previousStatus === "detected" && newStatus === "none") {
      await logLifecycleEvent({
        requestId: request.id,
        event: "drift_cleared",
        actor: "system",
        source: "workflow/drift-plan",
        data: {
          runId: body.runId,
          runUrl: body.runUrl,
        },
      })
    }

    // Update request with drift block
    const updated = await updateRequest(requestId, (current) => ({
      ...current,
      drift: {
        status: newStatus,
        lastCheckedAt: new Date().toISOString(),
        runId: body.runId,
        runUrl: body.runUrl,
        summary: body.summary,
      },
    }))

    return NextResponse.json({
      success: true,
      request: updated,
      driftStatus: newStatus,
      transition: previousStatus !== newStatus ? `${previousStatus} → ${newStatus}` : undefined,
    })
  } catch (error) {
    console.error("[api/requests/drift-result] error", error)
    return NextResponse.json({ error: "Failed to process drift result" }, { status: 500 })
  }
}
