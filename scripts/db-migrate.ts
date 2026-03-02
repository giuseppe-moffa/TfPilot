#!/usr/bin/env tsx
/**
 * Run pending SQL migrations. Loads .env.local then .env. Requires DATABASE_URL or PG* env.
 * Usage: npm run db:migrate
 */

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// Load env for CLI (Next.js does not load .env.local for standalone scripts)
try {
  require("dotenv").config({ path: ".env.local" })
  require("dotenv").config()
} catch {
  // dotenv optional
}

const migrationsDir = join(process.cwd(), "migrations")

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
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const files = await readdir(migrationsDir)
    const sqlFiles = files
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
      .sort()

    if (sqlFiles.length === 0) {
      console.log("No migrations found in migrations/")
      return
    }

    const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations")
    const appliedSet = new Set(applied.rows.map((r) => r.name))

    for (const file of sqlFiles) {
      const name = file.replace(/\.sql$/, "")
      if (appliedSet.has(name)) {
        console.log("Skip (already applied):", name)
        continue
      }
      const path = join(migrationsDir, file)
      const sql = await readFile(path, "utf8")
      await client.query(sql)
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name])
      console.log("Applied:", name)
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
