import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getTemplatesIndex, getTemplate } from "@/lib/templates-store"

/**
 * Returns only enabled templates (full objects) for the create-request flow.
 * Requires authenticated session.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const index = await getTemplatesIndex()
    const enabled = index.filter((e) => e.enabled)
    const templates = await Promise.all(
      enabled.map((e) =>
        getTemplate(e.id).catch(() => null)
      )
    )
    const valid = templates.filter((t): t is Awaited<ReturnType<typeof getTemplate>> => t !== null)
    return NextResponse.json(valid)
  } catch (err) {
    console.error("[templates] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load templates" },
      { status: 500 }
    )
  }
}
