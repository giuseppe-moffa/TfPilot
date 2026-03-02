import { NextResponse } from "next/server"
import { query } from "@/lib/db/pg"
import { isDatabaseConfigured } from "@/lib/db/config"

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database not configured (set DATABASE_URL or PG* env)" },
      { status: 503 }
    )
  }

  try {
    const result = await query("SELECT 1 as one")
    if (result == null) {
      return NextResponse.json(
        { ok: false, error: "Database connection not available" },
        { status: 503 }
      )
    }
    const row = result.rows[0]
    if (!row || (row as { one?: number }).one !== 1) {
      return NextResponse.json(
        { ok: false, error: "Unexpected health check result" },
        { status: 503 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, error: message },
      { status: 503 }
    )
  }
}
