import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getWorkspaceTemplatesIndex } from "@/lib/workspace-templates-store"

/**
 * GET /api/workspace-templates
 * Returns workspace template index from S3 (templates/workspaces/index.json).
 * Used by create-workspace UI to list templates. Requires authenticated session.
 * Index not seeded → 503.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  try {
    const index = await getWorkspaceTemplatesIndex()
    const templates = index.map((e) => ({
      id: e.id,
      label: e.name,
      name: e.name,
      description: e.description,
      latest_version: e.latest_version,
      category: e.category,
      icon: e.icon,
      recommended: e.recommended,
      modules: [], // not in index; Phase 4 can load doc for preview
    }))
    return NextResponse.json(templates)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Seed the templates bucket") || msg.includes("not found")) {
      return NextResponse.json(
        { error: "Workspace templates index not available. Seed the templates bucket before use." },
        { status: 503 }
      )
    }
    console.error("[workspace-templates] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load workspace templates" },
      { status: 500 }
    )
  }
}
