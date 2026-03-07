import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import { isPlatformAdmin } from "@/lib/db/platformAdmins"
import { isOrgArchived } from "@/lib/db/orgs"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }
  const orgRole =
    session.orgId && session.login
      ? await getUserOrgRole(session.login, session.orgId)
      : null
  const isOrgAdmin = orgRole === "admin"
  const platformAdmin = await isPlatformAdmin(session.login)
  const org =
    session.orgId && session.orgSlug
      ? {
          orgId: session.orgId,
          orgSlug: session.orgSlug,
          orgArchived: await isOrgArchived(session.orgId),
        }
      : undefined
  return NextResponse.json({
    authenticated: true,
    user: session,
    orgRole,
    isOrgAdmin,
    isPlatformAdmin: platformAdmin,
    org,
  })
}
