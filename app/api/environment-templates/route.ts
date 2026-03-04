import { NextResponse } from "next/server"

import { environmentTemplates } from "@/config/environment-templates"
import { getSessionFromCookies } from "@/lib/auth/session"

/**
 * GET /api/environment-templates
 * Returns environment templates (raw array). Requires authenticated session.
 * Per ENVIRONMENT_TEMPLATES_DELTA §11.2.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    return NextResponse.json(environmentTemplates)
  } catch (err) {
    console.error("[environment-templates] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load environment templates" },
      { status: 500 }
    )
  }
}
