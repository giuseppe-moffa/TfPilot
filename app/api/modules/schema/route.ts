import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { moduleRegistry } from "@/config/module-registry"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const generatedAt = new Date().toISOString()
  const schemaVersion = 2

  // Tags are server-authoritative: never expose in UI so users cannot configure them.
  const modules = moduleRegistry.map((entry) => ({
    type: entry.type,
    category: entry.category ?? "core",
    description: entry.description ?? "",
    fields: (entry.fields ?? []).filter((f) => f.name !== "tags").map((f) => ({
      name: f.name,
      type: f.type,
      required: Boolean(f.required),
      default: f.default,
      description: f.description ?? "",
      enum: f.enum ?? undefined,
      immutable: Boolean(f.immutable),
      readOnly: Boolean(f.readOnly),
      sensitive: Boolean(f.sensitive),
      risk_level: f.risk_level,
      category: f.category ?? "core",
    })),
  }))

  return NextResponse.json({ success: true, schemaVersion, generatedAt, modules })
}
