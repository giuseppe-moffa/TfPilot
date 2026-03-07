import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getTemplatesIndex, getTemplate } from "@/lib/templates-store"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Returns a single template by id if it exists and is enabled.
 * Requires authenticated session. For disabled or missing template returns 404.
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
  try {
    const index = await getTemplatesIndex(session.orgId)
    const entry = index.find((e) => e.id === id)
    if (!entry?.enabled) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const template = await getTemplate(session.orgId, id)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/[id]] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load template" },
      { status: 500 }
    )
  }
}
