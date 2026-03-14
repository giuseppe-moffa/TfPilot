import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { getSessionFromCookies } from "@/lib/auth/session"

/**
 * POST /api/workspace-templates/admin/[id]/delete
 * Deprecated: delete is not supported for workspace templates store.
 * Templates are read-only from S3; re-seed to replace.
 */
export async function POST() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  return NextResponse.json(
    {
      error: "Template delete is deprecated. Workspace templates are read-only from S3. Re-seed to replace.",
    },
    { status: 410 }
  )
}
