/**
 * Platform admin auth helper.
 * Platform admins can list/create/archive/restore orgs.
 * Uses platform_admins table; replaces legacy TFPILOT_ADMINS.
 */

import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { isPlatformAdmin } from "@/lib/db/platformAdmins"

export type RequirePlatformAdminResult =
  | { error: NextResponse }
  | { session: { login: string; orgId?: string; orgSlug?: string } }

/**
 * Require platform admin. Returns session if allowed, or error response.
 */
export async function requirePlatformAdmin(): Promise<RequirePlatformAdminResult> {
  const session = await getSessionFromCookies()
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  const ok = await isPlatformAdmin(session.login)
  if (!ok) {
    return { error: NextResponse.json(null, { status: 404 }) }
  }
  return { session }
}
