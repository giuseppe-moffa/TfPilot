/**
 * Admin audit: list (org_id, project_key) pairs from workspaces that have no matching project row.
 * Read-only. No auto-fix. Used to surface workspaces orphaned after projects became first-class.
 */

import { NextRequest, NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { listOrphanedWorkspaceProjectKeys } from "@/lib/db/projects"

export async function GET(req: NextRequest) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error

  const orgId = req.nextUrl.searchParams.get("org_id") ?? undefined

  const orphaned = await listOrphanedWorkspaceProjectKeys(orgId || undefined)

  return NextResponse.json({
    orphaned,
    count: orphaned.length,
  })
}
