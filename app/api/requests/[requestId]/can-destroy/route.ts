import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getRequest } from "@/lib/storage/requestsStore"
import { getRequestOrgId } from "@/lib/db/requestsList"
import { requireRequestProjectPermission } from "@/lib/auth/requestProjectPermission"

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
    if (!session.orgId) {
      return NextResponse.json({ canDestroy: false, error: "Not found" }, { status: 404 })
    }
    const archivedRes = await requireActiveOrg(session)
    if (archivedRes) return archivedRes

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ canDestroy: false, error: "Not found" }, { status: 404 })
    }
    const permRes = await requireRequestProjectPermission(
      { login: session.login, orgId: session.orgId ?? null },
      request as { project_key?: string; org_id?: string },
      requestId,
      "destroy",
      { getRequestOrgId }
    )
    if (permRes) {
      const reason = permRes.status === 404 ? "not_found" : "insufficient_permission"
      return NextResponse.json({ canDestroy: false, reason })
    }

    return NextResponse.json({ canDestroy: true })
  } catch (error) {
    console.error("[api/requests/can-destroy] error", error)
    return NextResponse.json({ canDestroy: false, error: "Failed to check permissions" }, { status: 500 })
  }
}
