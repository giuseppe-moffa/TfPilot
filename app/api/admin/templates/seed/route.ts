import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { getTemplate, createTemplateWithId } from "@/lib/templates-store"
import { DEFAULT_SEED_TEMPLATES } from "@/lib/templates-store-seed-defaults"

/**
 * POST /api/admin/templates/seed
 * One-time migration: creates the legacy default templates in S3 if they don't exist.
 * Admin-only. Idempotent: skips any template that already exists (same id).
 */
export async function POST() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden

  const created: string[] = []
  const skipped: string[] = []

  for (const seed of DEFAULT_SEED_TEMPLATES) {
    const { id, ...payload } = seed
    try {
      await getTemplate(id)
      skipped.push(id)
    } catch {
      try {
        await createTemplateWithId(id, payload)
        created.push(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[admin/templates/seed] Failed to create:", id, err)
        return NextResponse.json(
          {
            error: `Failed to create template ${id}`,
            detail: message,
            created,
            skipped,
          },
          { status: 500 }
        )
      }
    }
  }

  return NextResponse.json({ created, skipped })
}
