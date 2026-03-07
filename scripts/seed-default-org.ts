#!/usr/bin/env tsx
/**
 * Seed default org and org memberships. Uses platform_admins for org admins.
 * Idempotent. Usage: npm run db:seed
 * Run db:seed-platform-admins first if you need initial platform admins.
 */
import "./load-env"

import { seedDefaultOrg } from "@/lib/db/seedDefaultOrg"
import { listPlatformAdmins } from "@/lib/db/platformAdmins"
import { isDatabaseConfigured } from "@/lib/db/config"

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("Database not configured. Set DATABASE_URL or PG* env.")
    process.exit(1)
  }

  const admins = await listPlatformAdmins()
  const result = await seedDefaultOrg(admins, [])
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
