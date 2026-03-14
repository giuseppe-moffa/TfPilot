#!/usr/bin/env tsx
/**
 * Drop all application tables and schema_migrations for a clean baseline.
 * After running this, run: npm run db:migrate
 * Then optionally: npm run db:seed, npm run db:seed-platform-admins, and seed workspace templates via API.
 * Requires DATABASE_URL or PG* env.
 */

try {
  require("dotenv").config({ path: ".env.local" })
  require("dotenv").config()
} catch {
  // dotenv optional
}

function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL
  if (url?.trim()) return url.trim()
  const host = process.env.PGHOST
  const user = process.env.PGUSER
  const password = process.env.PGPASSWORD
  const database = process.env.PGDATABASE ?? process.env.PGNAME
  const port = process.env.PGPORT
  if (!host || !user) return null
  const portPart = port ? `:${port}` : ""
  const passwordPart = password ? `:${encodeURIComponent(password)}` : ""
  const auth = `${encodeURIComponent(user)}${passwordPart}@`
  return `postgresql://${auth}${host}${portPart}/${database ?? "tfpilot"}`
}

const DROP_ORDER = [
  "audit_events",
  "requests_index",
  "project_user_roles",
  "project_team_roles",
  "project_team_access",
  "team_memberships",
  "workspaces",
  "teams",
  "projects",
  "org_memberships",
  "platform_admins",
  "orgs",
  "schema_migrations",
]

async function main() {
  const url = getDatabaseUrl()
  if (!url) {
    console.error("Database not configured. Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE.")
    process.exit(1)
  }

  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: url })

  try {
    await client.connect()
  } catch (err) {
    console.error("Failed to connect:", (err as Error)?.message ?? err)
    process.exit(1)
  }

  try {
    await client.query("DROP TYPE IF EXISTS project_role CASCADE")
    for (const table of DROP_ORDER) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
      console.log("Dropped:", table)
    }
    console.log("Reset complete. Run: npm run db:migrate")
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
