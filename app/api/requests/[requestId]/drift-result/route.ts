import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"

/**
 * Validates a GitHub token by making a lightweight API call to verify it's valid
 * Uses a timeout to prevent hanging if GitHub API is slow/unavailable
 */
async function validateGitHubToken(token: string): Promise<boolean> {
  try {
    // Use AbortController for timeout (5 seconds max)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "TfPilot",
      },
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    // Token is valid if we get a 200 response
    return res.ok
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[api/requests/drift-result] Token validation timeout")
    } else {
      console.error("[api/requests/drift-result] Token validation error:", error)
    }
    return false
  }
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

    // Validate GitHub token - must be present and valid
    const authHeader = req.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[api/requests/drift-result] Missing or invalid Authorization header")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "").trim()
    if (!token) {
      console.warn("[api/requests/drift-result] Empty token")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Validate token with GitHub API
    const isValidToken = await validateGitHubToken(token)
    if (!isValidToken) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                 req.headers.get("x-real-ip") || 
                 "unknown"
      console.warn(`[api/requests/drift-result] Invalid GitHub token from IP: ${ip}, requestId: ${requestId}`)
      return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 })
    }

    // Log successful authentication for security monitoring
    console.log(`[api/requests/drift-result] Valid token, processing drift result for requestId: ${requestId}`)

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
