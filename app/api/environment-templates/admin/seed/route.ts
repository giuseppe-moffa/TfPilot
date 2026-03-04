import { NextResponse } from "next/server"

import { environmentTemplates } from "@/config/environment-templates"
import { requireAdminByEmail } from "@/lib/auth/admin"
import {
  envTemplatesIndexExists,
  seedEnvTemplatesFromConfig,
  ENV_TEMPLATE_VALIDATION_FAILED,
} from "@/lib/env-templates-store"

/**
 * POST /api/environment-templates/admin/seed
 * One-time bootstrap: writes config templates to S3. Idempotent: 409 if already initialized.
 */
export async function POST() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden

  if (await envTemplatesIndexExists()) {
    return NextResponse.json(
      { error: "ENV_TEMPLATES_ALREADY_INITIALIZED" },
      { status: 409 }
    )
  }

  try {
    const { created } = await seedEnvTemplatesFromConfig(environmentTemplates)
    return NextResponse.json({ created })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === "ENV_TEMPLATES_ALREADY_INITIALIZED") {
      return NextResponse.json(
        { error: "ENV_TEMPLATES_ALREADY_INITIALIZED" },
        { status: 409 }
      )
    }
    if (code === ENV_TEMPLATE_VALIDATION_FAILED) {
      return NextResponse.json(
        { error: ENV_TEMPLATE_VALIDATION_FAILED },
        { status: 400 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error("[env-templates/admin/seed] error:", err)
    return NextResponse.json(
      { error: "Failed to seed environment templates", detail: message },
      { status: 500 }
    )
  }
}
