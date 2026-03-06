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
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    const template = await getTemplate(session.orgId, id)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/admin/[id]] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load template" },
      { status: 500 }
    )
  }
}

export async function PUT(req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    const updatedBy = session.email ?? undefined
    const body = (await req.json()) as UpdateTemplatePayload & { enabled?: boolean }
    const template = await updateTemplate(session.orgId, id, { ...body, updatedBy })
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/admin/[id]] PUT error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update template" },
      { status: 400 }
    )
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    const updatedBy = session?.email ?? undefined
    const template = await disableTemplate(session.orgId, id, updatedBy)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/admin/[id]] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to disable template" },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    const updatedBy = session?.email ?? undefined
    const body = (await req.json()) as { enabled?: boolean }
    const template =
      body.enabled === true
        ? await enableTemplate(session.orgId, id, updatedBy)
        : await updateTemplate(session.orgId, id, { ...body, updatedBy })
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[templates/admin/[id]] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 400 }
    )
  }
}
