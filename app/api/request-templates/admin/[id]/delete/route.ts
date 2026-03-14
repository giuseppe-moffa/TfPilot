import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getSessionFromCookies } from "@/lib/auth/session"
import { deleteTemplate } from "@/lib/templates-store"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, context: RouteContext) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    await deleteTemplate(session.orgId, id)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/admin/[id]/delete] error:", err)
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    )
  }
}
