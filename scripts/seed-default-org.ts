#!/usr/bin/env tsx
/**
 * Seed default org and org memberships from TFPILOT_ADMINS / TFPILOT_APPROVERS.
 * Idempotent. Usage: npm run db:seed
 */
import "./load-env"

import { env } from "@/lib/config/env"
import { seedDefaultOrg } from "@/lib/db/seedDefaultOrg"
import { isDatabaseConfigured } from "@/lib/db/config"

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("Database not configured. Set DATABASE_URL or PG* env.")
    process.exit(1)
  }

  const result = await seedDefaultOrg(env.TFPILOT_ADMINS, env.TFPILOT_APPROVERS)
  if (!result.ok) {
    console.error("Seed failed:", result.error)
    process.exit(1)
  }

  console.log(
    `Seed complete. Org inserted: ${result.orgInserted}. Memberships upserted: ${result.membershipsUpserted}.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
