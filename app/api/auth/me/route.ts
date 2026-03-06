import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole, type UserRole } from "@/lib/auth/roles"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }
  const role: UserRole = getUserRole(session.login)
  const org =
    session.orgId && session.orgSlug
      ? { orgId: session.orgId, orgSlug: session.orgSlug }
      : undefined
  return NextResponse.json({ authenticated: true, user: session, role, org })
}
