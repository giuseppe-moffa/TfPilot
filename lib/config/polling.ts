/**
 * Single source of truth for request-detail polling intervals.
 * Env-configurable via NEXT_PUBLIC_* so both client and server can read.
 * Safe to import in client code (no server-only dependencies).
 */

import { isActiveStatus, isTerminalStatus } from "@/lib/status/status-config"

/** Parse env as integer; must be finite and > 0, else return fallback. */
export function readIntEnv(name: string, fallback: number): number {
  const raw =
    typeof process !== "undefined" && process.env[name] != null
      ? process.env[name]
      : ""
  if (raw === "") return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

const DEFAULT_ACTIVE_MS = 10_000
const DEFAULT_IDLE_MS = 30_000
const DEFAULT_HIDDEN_MS = 120_000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000

/** Polling interval (ms) when request is in an active state (planning, applying, destroying). */
export const SYNC_INTERVAL_ACTIVE_MS = readIntEnv(
  "NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_ACTIVE_MS",
  DEFAULT_ACTIVE_MS
)

/** Polling interval (ms) when request is idle (e.g. plan_ready, approved, merged). */
export const SYNC_INTERVAL_IDLE_MS = readIntEnv(
  "NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_IDLE_MS",
  DEFAULT_IDLE_MS
)

/** Polling interval (ms) when tab is hidden. */
export const SYNC_INTERVAL_HIDDEN_MS = readIntEnv(
  "NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_HIDDEN_MS",
  DEFAULT_HIDDEN_MS
)

/** Interval (ms) to use after 429 until next successful fetch. */
export const SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS = readIntEnv(
  "NEXT_PUBLIC_TFPILOT_SYNC_RATE_LIMIT_BACKOFF_MS",
  DEFAULT_RATE_LIMIT_BACKOFF_MS
)

type RequestLike = { status?: string } | null | undefined

/**
 * Returns the sync polling interval (ms) for the given request and tab visibility.
 * Terminal status → 0 (stop polling). Tab hidden → HIDDEN_MS. Active → ACTIVE_MS. Else → IDLE_MS.
 */
export function getSyncPollingInterval(
  request: RequestLike,
  tabHidden: boolean
): number {
  if (!request) return SYNC_INTERVAL_IDLE_MS
  if (tabHidden) return SYNC_INTERVAL_HIDDEN_MS
  const status = request.status as string | undefined
  if (status && isTerminalStatus(status)) return 0
  if (status && isActiveStatus(status)) return SYNC_INTERVAL_ACTIVE_MS
  return SYNC_INTERVAL_IDLE_MS
}
