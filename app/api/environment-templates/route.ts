import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import {
  getEnvTemplatesIndex,
  getEnvTemplateIfExists,
} from "@/lib/env-templates-store"

/**
 * GET /api/environment-templates
 * Returns enabled environment templates (full objects) from S3.
 * Requires authenticated session. Index missing → [].
 * If index references a doc that is missing → skip item, log warn, continue.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const index = await getEnvTemplatesIndex()
    const enabled = index.filter((e) => e.enabled)
    const templates = []
    for (const entry of enabled) {
      const doc = await getEnvTemplateIfExists(entry.id)
      if (doc) {
        templates.push(doc)
      } else {
        console.warn("[env-templates] missing doc for id:", entry.id)
      }
    }
    return NextResponse.json(templates)
  } catch (err) {
    console.error("[env-templates] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load environment templates" },
      { status: 500 }
    )
  }
}
