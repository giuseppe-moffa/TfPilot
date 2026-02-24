import { NextRequest, NextResponse } from "next/server"

import { listRequests } from "@/lib/storage/requestsStore"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"

/**
 * Basic rate limiting check - simple in-memory counter (for production, use Redis or similar)
 * This is a basic protection against abuse
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30 // Max requests per minute per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = requestCounts.get(ip)

  if (!record || now > record.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  record.count++
  return true
}

/**
 * Validates the shared webhook secret for drift endpoints
 * Uses constant-time comparison to prevent timing attacks
 */
function validateWebhookSecret(providedSecret: string | null): boolean {
  const expectedSecret = process.env.TFPILOT_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error("[api/requests/drift-eligible] TFPILOT_WEBHOOK_SECRET not configured")
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

export async function GET(req: NextRequest) {
  try {
    // Validate shared webhook secret
    const providedSecret = req.headers.get("x-tfpilot-secret")
    if (!validateWebhookSecret(providedSecret)) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                 req.headers.get("x-real-ip") || 
                 "unknown"
      console.warn(`[api/requests/drift-eligible] Invalid webhook secret from IP: ${ip}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Basic rate limiting by IP (additional protection)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               req.headers.get("x-real-ip") || 
               "unknown"
    
    if (!checkRateLimit(ip)) {
      console.warn(`[api/requests/drift-eligible] Rate limit exceeded for IP: ${ip}`)
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded" },
        { status: 429 }
      )
    }

    // Get all requests (with higher limit for drift checking)
    const allRequests = await listRequests(500)

    // Filter for eligible dev requests (use derived status for consistency)
    const eligible = allRequests.filter((request: any) => {
      const status = deriveLifecycleStatus(request)
      // Must be dev environment
      if (request.environment?.toLowerCase() !== "dev") {
        return false
      }

      // Must not be destroyed/archived (check before narrowing so status type stays full)
      if (status === "destroyed" || status === "destroying") {
        return false
      }

      // Must be successfully applied (derived status applied or applyRun success; destroyed/destroying already excluded above)
      const isComplete =
        status === "applied" || request.applyRun?.conclusion === "success"

      if (!isComplete) {
        return false
      }

      // Must not be currently planning/applying/destroying
      const isActive =
        request.planRun?.status === "in_progress" ||
        request.planRun?.status === "queued" ||
        request.applyRun?.status === "in_progress" ||
        request.applyRun?.status === "queued" ||
        status === "planning" ||
        status === "applying"

      if (isActive) {
        return false
      }

      return true
    })

    // Return minimal metadata for workflow dispatch
    // Only expose what's necessary - request ID, project, and environment
    // targetOwner/targetRepo are only needed for workflow dispatch, but we can minimize exposure
    const result = eligible.map((request: any) => ({
      id: request.id,
      project: request.project,
      environment: request.environment,
      // Only include targetOwner/targetRepo if they exist (needed for workflow dispatch)
      ...(request.targetOwner && { targetOwner: request.targetOwner }),
      ...(request.targetRepo && { targetRepo: request.targetRepo }),
    }))

    // Log access for security monitoring (without sensitive data)
    console.log(`[api/requests/drift-eligible] Returning ${result.length} eligible requests to IP: ${ip}`)

    return NextResponse.json({
      success: true,
      requests: result,
      count: result.length,
    })
  } catch (error) {
    console.error("[api/requests/drift-eligible] error", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to enumerate eligible requests",
        requests: [],
        count: 0,
      },
      { status: 500 }
    )
  }
}
