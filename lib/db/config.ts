/**
 * Optional Postgres configuration. When DATABASE_URL (or PGHOST/PGUSER/...) is not set,
 * the app runs without a database; health and migrations are no-ops or return disabled.
 * Never log connection strings or secrets.
 */

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL
  if (url && url.trim()) return url.trim()

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

export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() != null
}
