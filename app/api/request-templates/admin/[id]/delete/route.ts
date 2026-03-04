import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { deleteTemplate } from "@/lib/templates-store"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    await deleteTemplate(id)
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
