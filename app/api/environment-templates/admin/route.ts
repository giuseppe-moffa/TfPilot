import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import {
  getEnvTemplatesIndex,
  createEnvTemplate,
  ENV_TEMPLATE_VALIDATION_FAILED,
  type CreateEnvTemplatePayload,
} from "@/lib/env-templates-store"

export async function GET() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  try {
    const index = await getEnvTemplatesIndex(session.orgId)
    return NextResponse.json(index)
  } catch (err) {
    console.error("[env-templates/admin] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load environment templates" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  try {
    const body = (await req.json()) as {
      label?: string
      description?: string
      modules?: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
      enabled?: boolean
    }
    const payload: CreateEnvTemplatePayload = {
      label: body.label,
      description: body.description,
      modules: body.modules ?? [],
      enabled: body.enabled ?? true,
    }
    const template = await createEnvTemplate(session.orgId, payload)
    return NextResponse.json(template, { status: 201 })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === ENV_TEMPLATE_VALIDATION_FAILED) {
      return NextResponse.json(
        { error: ENV_TEMPLATE_VALIDATION_FAILED },
        { status: 400 }
      )
    }
    console.error("[env-templates/admin] POST error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create template" },
      { status: 400 }
    )
  }
}
