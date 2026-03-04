import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
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
  const { id } = await context.params
  try {
    const index = await getTemplatesIndex()
    const entry = index.find((e) => e.id === id)
    if (!entry?.enabled) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const template = await getTemplate(id)
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
