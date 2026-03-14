import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getSessionFromCookies } from "@/lib/auth/session"
import {
  getWorkspaceTemplatesIndex,
  getWorkspaceTemplate,
} from "@/lib/workspace-templates-store"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/workspace-templates/admin/[id]
 * Returns a single workspace template by id (latest version). Uses new store only.
 */
export async function GET(_req: Request, context: RouteContext) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  if (!id?.trim()) {
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
        { error: "Workspace templates index not available." },
        { status: 503 }
      )
    }
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Template document missing", detail: msg }, { status: 500 })
    }
    console.error("[workspace-templates/admin/[id]] GET error:", err)
    return NextResponse.json({ error: "Failed to load template", detail: msg }, { status: 500 })
  }
}

/**
 * PUT /api/workspace-templates/admin/[id]
 * Deprecated: template updates are not supported; templates are read-only from S3.
 */
export async function PUT() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  return NextResponse.json(
    { error: "Template update is deprecated. Workspace templates are read-only from S3." },
    { status: 410 }
  )
}

/**
 * PATCH /api/workspace-templates/admin/[id]
 * Deprecated: template updates are not supported.
 */
export async function PATCH() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  return NextResponse.json(
    { error: "Template update is deprecated. Workspace templates are read-only from S3." },
    { status: 410 }
  )
}

/**
 * DELETE /api/workspace-templates/admin/[id]
 * Deprecated: soft-disable not supported for workspace templates store.
 */
export async function DELETE() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  return NextResponse.json(
    { error: "Template disable is deprecated. Workspace templates are read-only from S3." },
    { status: 410 }
  )
}
