import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getRequest } from "@/lib/storage/requestsStore"
import { env } from "@/lib/config/env"
import { getUserRole } from "@/lib/auth/roles"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    if (!requestId) {
      return NextResponse.json({ canDestroy: false, error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ canDestroy: false, error: "Not authenticated" }, { status: 401 })
    }

    // Admin role check applies to all destroys (pre-existing requirement)
    const role = getUserRole(session.login)
    if (role !== "admin") {
      return NextResponse.json({ canDestroy: false, reason: "requires_admin_role" })
    }

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ canDestroy: false, error: "Request not found" }, { status: 404 })
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    
    // Check prod destroy allowlist if it's a prod request (additional check beyond admin role)
    if (isProd && env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.length > 0) {
      const canDestroy = env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.includes(session.login)
      return NextResponse.json({ canDestroy, reason: canDestroy ? undefined : "not_in_destroy_prod_allowlist" })
    }

    // Non-prod or no allowlist configured - allow destroy (admin role already checked above)
    return NextResponse.json({ canDestroy: true })
  } catch (error) {
    console.error("[api/requests/can-destroy] error", error)
    return NextResponse.json({ canDestroy: false, error: "Failed to check permissions" }, { status: 500 })
  }
}
