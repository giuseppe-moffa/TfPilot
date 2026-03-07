#!/usr/bin/env tsx
/**
 * One-time bootstrap: seed platform_admins from TFPILOT_ADMINS env var.
 * Transitional only during RBAC migration. After rollout, remove TFPILOT_ADMINS
 * from env; new platform admins are managed via DB or future admin API.
 *
 * Usage: npm run db:seed-platform-admins
 * Requires: DATABASE_URL or PG* env, TFPILOT_ADMINS (optional, CSV of logins)
 */
import "./load-env"

import { withClient } from "@/lib/db/pg"
import { isDatabaseConfigured } from "@/lib/db/config"

function getAdminsFromEnv(): string[] {
  const raw = process.env.TFPILOT_ADMINS
  if (!raw || typeof raw !== "string") return []
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !s.startsWith("__BUILD_PLACEHOLDER_"))
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("Database not configured. Set DATABASE_URL or PG* env.")
    process.exit(1)
  }

  const logins = getAdminsFromEnv()
  if (logins.length === 0) {
    console.log("TFPILOT_ADMINS not set or empty. No platform admins to seed.")
    return
  }

  const result = await withClient(async (client) => {
    let inserted = 0
    for (const login of logins) {
      const r = await client.query(
        `INSERT INTO platform_admins (login, created_at)
         VALUES ($1, now())
         ON CONFLICT (login) DO NOTHING`,
        [login]
      )
      if ((r.rowCount ?? 0) > 0) inserted++
    }
    return { inserted, total: logins.length }
  })

  if (result === null) {
    console.error("Database not configured or connection failed.")
    process.exit(1)
  }

  console.log(
    `Platform admins seeded: ${result.inserted} new, ${result.total} total from TFPILOT_ADMINS.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
