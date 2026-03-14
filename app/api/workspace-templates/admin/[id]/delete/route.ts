import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"

/**
 * POST /api/workspace-templates/admin/[id]/delete
 * Deprecated: delete is not supported for workspace templates store.
 * Templates are read-only from S3; re-seed to replace. Platform admin only.
 */
export async function POST() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  return NextResponse.json(
    {
      error: "Template delete is deprecated. Workspace templates are read-only from S3. Re-seed to replace.",
    },
    { status: 410 }
  )
}
