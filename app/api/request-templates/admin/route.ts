import { NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  getTemplatesIndex,
  createTemplate,
  type CreateTemplatePayload,
} from "@/lib/templates-store"

export async function GET() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  try {
    const index = await getTemplatesIndex(session.orgId)
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
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes
  try {
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
    const template = await createTemplate(session.orgId, payload, createdBy)
    return NextResponse.json(template, { status: 201 })
  } catch (err) {
    console.error("[templates/admin] POST error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create template" },
      { status: 400 }
    )
  }
}
