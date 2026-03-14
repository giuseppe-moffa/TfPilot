/**
 * Admin audit: list request IDs that are missing any of environment_id, environment_key, environment_slug.
 * No auto-fix; fail loud for investigation.
 */

import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { requirePlatformAdmin } from "@/lib/auth/platformAdmin"
import { getRequest, listAllRequestIds } from "@/lib/storage/requestsStore"
import { isMissingEnvField } from "@/lib/requests/auditMissingEnv"

export async function GET() {
  const result = await requirePlatformAdmin()
  if ("error" in result) return result.error

  const ids = await listAllRequestIds()
  const missing: string[] = []

  for (const id of ids) {
    try {
      const req = await getRequest(id)
      if (isMissingEnvField(req as Record<string, unknown>)) {
        missing.push(id)
      }
    } catch {
      missing.push(id)
    }
  }

  return NextResponse.json({ request_ids: missing })
}
