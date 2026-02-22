import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { getSessionFromCookies } from "@/lib/auth/session"
import {
  getTemplate,
  updateTemplate,
  disableTemplate,
  enableTemplate,
  type UpdateTemplatePayload,
} from "@/lib/templates-store"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    const template = await getTemplate(id)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[admin/templates/[id]] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load template" },
      { status: 500 }
    )
  }
}

export async function PUT(req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    const session = await getSessionFromCookies()
    const updatedBy = session?.email ?? undefined
    const body = (await req.json()) as UpdateTemplatePayload & { enabled?: boolean }
    const template = await updateTemplate(id, { ...body, updatedBy })
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[admin/templates/[id]] PUT error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update template" },
      { status: 400 }
    )
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    const session = await getSessionFromCookies()
    const updatedBy = session?.email ?? undefined
    const template = await disableTemplate(id, updatedBy)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[admin/templates/[id]] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to disable template" },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    const session = await getSessionFromCookies()
    const updatedBy = session?.email ?? undefined
    const body = (await req.json()) as { enabled?: boolean }
    const template =
      body.enabled === true
        ? await enableTemplate(id, updatedBy)
        : await updateTemplate(id, { ...body, updatedBy })
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[admin/templates/[id]] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 400 }
    )
  }
}
