import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { getSessionFromCookies } from "@/lib/auth/session"
import {
  getTemplatesIndex,
  createTemplate,
  type CreateTemplatePayload,
} from "@/lib/templates-store"

export async function GET() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  try {
    const index = await getTemplatesIndex()
    return NextResponse.json(index)
  } catch (err) {
    console.error("[templates/admin] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load templates" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  try {
    const session = await getSessionFromCookies()
    const createdBy = session?.email ?? null
    const body = (await req.json()) as CreateTemplatePayload & { id?: string; createdAt?: string; updatedAt?: string }
    const payload: CreateTemplatePayload = {
      label: body.label ?? "",
      description: body.description,
      project: body.project ?? "",
      environment: body.environment ?? "",
      module: body.module ?? "",
      defaultConfig: body.defaultConfig ?? {},
      uiSchema: body.uiSchema,
      enabled: body.enabled ?? true,
      lockEnvironment: body.lockEnvironment,
      allowCustomProjectEnv: body.allowCustomProjectEnv,
    }
    const template = await createTemplate(payload, createdBy)
    return NextResponse.json(template, { status: 201 })
  } catch (err) {
    console.error("[templates/admin] POST error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create template" },
      { status: 400 }
    )
  }
}
