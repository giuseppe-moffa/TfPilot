import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getWorkspaceTemplatesIndex } from "@/lib/workspace-templates-store"

/**
 * GET /api/workspace-templates/admin
 * Returns workspace template index from S3 (templates/workspaces/index.json).
 * Platform admin only.
 */
export async function GET() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  try {
    const index = await getWorkspaceTemplatesIndex()
    return NextResponse.json(index)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("index not found") || msg.includes("Seed the templates bucket")) {
      // Return 200 with empty array so admin UI still shows "Import default templates"
      return NextResponse.json([])
    }
    console.error("[workspace-templates/admin] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load workspace templates", detail: msg },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workspace-templates/admin
 * Deprecated: creating individual templates via this route is not supported.
 * Use POST /api/workspace-templates/admin/seed to seed templates.
 */
export async function POST() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  return NextResponse.json(
    {
      error: "Use POST /api/workspace-templates/admin/seed to seed workspace templates.",
      deprecated: true,
    },
    { status: 501 }
  )
}
