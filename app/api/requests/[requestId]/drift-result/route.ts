import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"

/**
 * Validates the shared webhook secret for drift endpoints
 * Uses constant-time comparison to prevent timing attacks
 */
function validateWebhookSecret(providedSecret: string | null): boolean {
  const expectedSecret = process.env.TFPILOT_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error("[api/requests/drift-result] TFPILOT_WEBHOOK_SECRET not configured")
    return false
  }

  if (!providedSecret) {
    return false
  }

  // Constant-time comparison to prevent timing attacks
  if (providedSecret.length !== expectedSecret.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < expectedSecret.length; i++) {
    result |= providedSecret.charCodeAt(i) ^ expectedSecret.charCodeAt(i)
  }
  return result === 0
}

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

    // Validate shared webhook secret
    const providedSecret = req.headers.get("x-tfpilot-secret")
    if (!validateWebhookSecret(providedSecret)) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                 req.headers.get("x-real-ip") || 
                 "unknown"
      console.warn(`[api/requests/drift-result] Invalid webhook secret from IP: ${ip}, requestId: ${requestId}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Log successful authentication for security monitoring
    console.log(`[api/requests/drift-result] Valid secret, processing drift result for requestId: ${requestId}`)

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
    const [updated] = await updateRequest(requestId, (current) => ({
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
