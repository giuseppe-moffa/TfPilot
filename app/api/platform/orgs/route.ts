/**
 * Platform orgs: list all orgs with member counts (GET).
 * Create org with initial admin (POST).
 * Platform-admin only (platform_admins table).
 */

import { NextRequest, NextResponse } from "next/server"

import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import { listAllOrgsWithCounts, createOrgWithInitialAdmin } from "@/lib/db/orgs"

export async function GET(req: NextRequest) {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error

  const { searchParams } = new URL(req.url)
  const filterParam = searchParams.get("filter")
  const filter =
    filterParam === "archived" || filterParam === "all"
      ? (filterParam as "archived" | "all")
      : "active"

  const orgs = await listAllOrgsWithCounts({ filter })
  return NextResponse.json({ orgs })
}

export async function POST(req: NextRequest) {
  const platformResult = await requirePlatformAdmin()
  if ("error" in platformResult) return platformResult.error

  let body: { slug?: unknown; name?: unknown; adminLogin?: unknown }
  try {
    body = (await req.json()) as { slug?: unknown; name?: unknown; adminLogin?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawSlug = typeof body.slug === "string" ? body.slug.trim() : ""
  const slug = rawSlug.toLowerCase()
  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const rawAdminLogin = typeof body.adminLogin === "string" ? body.adminLogin.trim() : ""
  const adminLogin = rawAdminLogin.toLowerCase()
  if (!adminLogin) {
    return NextResponse.json({ error: "Admin login is required" }, { status: 400 })
  }

  const createResult = await createOrgWithInitialAdmin(slug, name, adminLogin)
  if (!createResult.ok) {
    if (createResult.error === "slug_exists") {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to create org" }, { status: 500 })
  }

  const { session } = platformResult
  await writeAuditEvent(auditWriteDeps, {
    org_id: createResult.org.id,
    actor_login: session.login,
    source: "user",
    event_type: "org_created",
    entity_type: "org",
    entity_id: createResult.org.id,
    metadata: { slug: createResult.org.slug, name: createResult.org.name },
  })

  return NextResponse.json({ org: createResult.org })
}
