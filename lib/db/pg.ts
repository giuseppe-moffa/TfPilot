/**
 * Postgres connection pool and query helpers. Only created when DATABASE_URL (or PG* env) is set.
 * Graceful shutdown on process exit. No secrets in logs.
 */

import type { Pool, PoolClient, QueryResultRow } from "pg"
import { getDatabaseUrl } from "./config"

let pool: Pool | null = null

function createPool(): Pool | null {
  const url = getDatabaseUrl()
  if (!url) return null

  // Dynamic require so app starts without pg when DB is disabled (pg has no default export)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg")
  const p = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  p.on("error", (err) => {
    console.warn("[db] pool error (no secrets)", err?.message ?? String(err))
  })

  return p
}

/**
 * Returns the shared pool, or null if database is not configured. Pool is created lazily.
 */
export function getPool(): Pool | null {
  if (pool !== null) return pool
  pool = createPool()
  if (pool && typeof process !== "undefined") {
    const shutdown = () => {
      if (pool) {
        pool.end().catch((err) => console.warn("[db] shutdown error", err?.message ?? String(err)))
        pool = null
      }
    }
    process.once("SIGTERM", shutdown)
    process.once("SIGINT", shutdown)
  }
  return pool
}

/**
 * Run a parameterized query. Returns null if database is not configured.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<{ rows: T[]; rowCount: number } | null> {
  const p = getPool()
  if (!p) return null
  const result = await p.query<T>(text, values)
  return { rows: result.rows, rowCount: result.rowCount ?? 0 }
}

/**
 * Execute a callback with a client from the pool. Returns null if database is not configured.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T | null> {
  const p = getPool()
  if (!p) return null
  const client = await p.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/**
 * Close the pool (for tests or graceful shutdown). No-op if not configured.
 */
export async function end(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
