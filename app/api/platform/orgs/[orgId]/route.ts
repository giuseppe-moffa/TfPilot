/**
 * GET /api/platform/orgs/[orgId] — Org detail for platform admin.
 * Platform-admin only. 404 if org not found or non-admin.
 */

import { NextRequest, NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getOrgById, listOrgMembers } from "@/lib/db/orgs"
import { listTeamsWithCounts } from "@/lib/db/teams"
import { countProjectsByOrg } from "@/lib/db/projects"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error

  const { orgId } = await params
  const org = await getOrgById(orgId)
  if (!org) {
    return NextResponse.json(null, { status: 404 })
  }

  const [members, teams, projectCount] = await Promise.all([
    listOrgMembers(orgId),
    listTeamsWithCounts(orgId),
    countProjectsByOrg(orgId),
  ])

  return NextResponse.json({
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      createdAt: org.created_at,
      archivedAt: org.archived_at,
    },
    stats: {
      memberCount: members.length,
      teamCount: teams.length,
      projectCount,
    },
    members: members.map((m) => ({
      login: m.login,
      role: m.role,
      joinedAt: m.created_at,
    })),
    teams: teams.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      membersCount: t.membersCount,
    })),
  })
}
