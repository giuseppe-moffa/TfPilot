import { NextRequest, NextResponse } from "next/server"

import { listRequests } from "@/lib/storage/requestsStore"

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

export async function GET(req: NextRequest) {
  try {
    // Basic rate limiting by IP
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

    // Filter for eligible dev requests
    const eligible = allRequests.filter((request: any) => {
      // Must be dev environment
      if (request.environment?.toLowerCase() !== "dev") {
        return false
      }

      // Must be successfully applied (status complete or applyRun success)
      const isComplete =
        request.status === "complete" ||
        (request.applyRun?.conclusion === "success" && request.status !== "destroyed")

      if (!isComplete) {
        return false
      }

      // Must not be destroyed/archived
      if (request.status === "destroyed" || request.status === "destroying") {
        return false
      }

      // Must not be currently planning/applying/destroying
      const isActive =
        request.planRun?.status === "in_progress" ||
        request.planRun?.status === "queued" ||
        request.applyRun?.status === "in_progress" ||
        request.applyRun?.status === "queued" ||
        request.status === "planning" ||
        request.status === "applying"

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
