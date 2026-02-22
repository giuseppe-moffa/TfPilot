import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"

/**
 * Gate for admin-only routes. If the current user's email is not in
 * TFPILOT_ADMIN_EMAILS, returns a 404 response (so non-admins do not see that
 * the route exists). Returns null if the user is allowed.
 */
export async function requireAdminByEmail(): Promise<NextResponse | null> {
  const session = await getSessionFromCookies()
  const email = session?.email ?? null
  if (!email || env.TFPILOT_ADMIN_EMAILS.length === 0 || !env.TFPILOT_ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return null
}
