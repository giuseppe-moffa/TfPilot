import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  getWorkspaceTemplatesIndex,
  getWorkspaceTemplate,
} from "@/lib/workspace-templates-store"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/workspace-templates/[id]
 * Returns a single workspace template by id (latest version from index).
 * Uses workspace-templates-store only (templates/workspaces/ S3 layout).
 */
export async function GET(_req: Request, context: RouteContext) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { id } = await context.params
  if (!id || id.trim() === "") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const index = await getWorkspaceTemplatesIndex()
    const entry = index.find((e) => e.id === id.trim())
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const template = await getWorkspaceTemplate(entry.id, entry.latest_version)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("index not found") || msg.includes("Seed the templates bucket")) {
      return NextResponse.json(
        { error: "Workspace templates index not available. Seed the templates bucket before use." },
        { status: 503 }
      )
    }
    if (msg.includes("not found") || msg.includes("Not found")) {
      return NextResponse.json(
        { error: "Template document missing for indexed version", detail: msg },
        { status: 500 }
      )
    }
    console.error("[workspace-templates/[id]] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load template", detail: msg },
      { status: 500 }
    )
  }
}
