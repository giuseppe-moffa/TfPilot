import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import {
  getEnvTemplate,
  updateEnvTemplate,
  disableEnvTemplate,
  enableEnvTemplate,
  ENV_TEMPLATE_VALIDATION_FAILED,
  type UpdateEnvTemplatePayload,
} from "@/lib/env-templates-store"

type RouteContext = { params: Promise<{ id: string }> }

/** Allowed update keys; prevents id override and unknown top-level field injection. */
const ALLOWED_UPDATE_KEYS = ["label", "description", "modules", "enabled"] as const

function pickUpdatePayload(
  body: Record<string, unknown>
): UpdateEnvTemplatePayload {
  const payload: UpdateEnvTemplatePayload = {}
  for (const k of ALLOWED_UPDATE_KEYS) {
    if (k in body) (payload as Record<string, unknown>)[k] = body[k]
  }
  return payload
}

export async function GET(_req: Request, context: RouteContext) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const { id } = await context.params
  try {
    const template = await getEnvTemplate(id)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[env-templates/admin/[id]] GET error:", err)
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
    const body = (await req.json()) as Record<string, unknown>
    const payload = pickUpdatePayload(body)
    const template = await updateEnvTemplate(id, payload)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { code?: string; name?: string })?.code
    const name = (err as { name?: string })?.name
    if (code === ENV_TEMPLATE_VALIDATION_FAILED) {
      return NextResponse.json(
        { error: ENV_TEMPLATE_VALIDATION_FAILED },
        { status: 400 }
      )
    }
    if (name === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[env-templates/admin/[id]] PUT error:", err)
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
    const template = await disableEnvTemplate(id)
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[env-templates/admin/[id]] DELETE error:", err)
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
    const body = (await req.json()) as Record<string, unknown>
    const template =
      body.enabled === true
        ? await enableEnvTemplate(id)
        : await updateEnvTemplate(id, pickUpdatePayload(body))
    return NextResponse.json(template)
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    const name = (err as { name?: string })?.name
    if (code === ENV_TEMPLATE_VALIDATION_FAILED) {
      return NextResponse.json(
        { error: ENV_TEMPLATE_VALIDATION_FAILED },
        { status: 400 }
      )
    }
    if (name === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[env-templates/admin/[id]] PATCH error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update template" },
      { status: 400 }
    )
  }
}
