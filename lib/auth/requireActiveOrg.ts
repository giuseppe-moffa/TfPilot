/**
 * Runtime guard for archived orgs.
 * Use in org-scoped API routes after session/orgId checks.
 * Returns 403 when session.orgId exists and the org is archived.
 */

import { NextResponse } from "next/server"

import type { SessionPayload } from "./session"
import { isOrgArchived } from "@/lib/db/orgs"

export const ARCHIVED_ORG_ERROR = "Organization archived" as const

/**
 * If session has orgId and that org is archived, returns 403 JSON response.
 * Otherwise returns null (proceed).
 */
export async function requireActiveOrg(
  session: SessionPayload | null
): Promise<NextResponse | null> {
  if (!session?.orgId) return null
  const archived = await isOrgArchived(session.orgId)
  if (!archived) return null
  return NextResponse.json({ error: ARCHIVED_ORG_ERROR }, { status: 403 })
}
