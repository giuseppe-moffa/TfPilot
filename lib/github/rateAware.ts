/**
 * Rate-aware GitHub API wrapper: in-memory TTL cache, rate-limit backoff, and retry.
 * Use for GETs only; do not cache POST/dispatch.
 *
 * Call sites migrated (Phase 1):
 * - auth/github/callback: GET /user, GET /user/emails → 60s TTL
 * - requests/[requestId]/sync: PR, PR reviews, cleanup PR, workflow runs, single run, jobs, logs → 30s/15s/15s/15s/10s/10s/0
 * - github/plan: GET pulls/:prNumber, GET workflow runs → 30s, 15s
 * - github/apply: GET workflow runs → 15s
 * - requests/[requestId]/destroy: GET workflow runs → 15s
 * - requests/update: GET workflow runs, GET pulls/:prNumber (closeSupersededPr) → 15s, 30s
 * - requests (create): GET workflow runs → 15s
 * - github/merge: GET pulls/:prNum → 30s
 *
 * Retry/backoff: On 403/429 with x-ratelimit-remaining=0, wait until x-ratelimit-reset (cap 30s dev / 60s prod).
 * On retry-after header, wait that many seconds (capped). On 5xx, exponential backoff 1s, 2s, 4s (max 3 retries).
 * Logs: github.cache_hit (info), github.retry (warn), github.rate_limited (warn).
 */

import { ghResponse } from "@/lib/github/client"
import { logInfo, logWarn } from "@/lib/observability/logger"

const MAX_CACHE_ENTRIES = 500
const MAX_RATE_LIMIT_WAIT_MS_DEV = 30_000
const MAX_RATE_LIMIT_WAIT_MS_PROD = 60_000
const TRANSIENT_BACKOFF_MS = [1000, 2000, 4000]
const MAX_RETRIES = 3

type CacheEntry<T> = { value: T; expiresAt: number; etag?: string }

const cache = new Map<string, CacheEntry<unknown>>()
const keyOrder: string[] = []

function evictOldest() {
  while (keyOrder.length >= MAX_CACHE_ENTRIES && keyOrder.length > 0) {
    const k = keyOrder.shift()!
    cache.delete(k)
  }
}

function getFromCache<T>(key: string): { value: T; etag?: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry || Date.now() > entry.expiresAt) return null
  return { value: entry.value, etag: entry.etag }
}

function setCache<T>(key: string, value: T, ttlMs: number, etag?: string) {
  if (ttlMs <= 0) return
  evictOldest()
  if (!cache.has(key)) keyOrder.push(key)
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    etag,
  })
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function maxRateLimitWaitMs(): number {
  return isDev() ? MAX_RATE_LIMIT_WAIT_MS_DEV : MAX_RATE_LIMIT_WAIT_MS_PROD
}

export type GithubRequestContext = {
  correlationId?: string
  route?: string
}

export type GithubRequestOpts<T> = {
  token: string
  key: string
  ttlMs: number
  path: string
  method?: "GET" | "HEAD"
  /**
   * Parse response body to T. Default: res.json().
   * Use (r) => r.text() for text endpoints.
   */
  parseResponse?: (res: Response) => Promise<T>
  tags?: string[]
  context?: GithubRequestContext
}

/**
 * Execute a single GitHub GET (or HEAD) with cache, rate-limit backoff, and retry.
 * Do not use for POST/PATCH etc.
 */
export async function githubRequest<T>(opts: GithubRequestOpts<T>): Promise<T> {
  const {
    token,
    key,
    ttlMs,
  path,
  method = "GET",
  parseResponse = (res) => res.json() as Promise<T>,
  context,
} = opts

  const logData = (extra?: Record<string, unknown>) =>
    ({ ...context, ...extra }) as { correlationId?: string; route?: string; [k: string]: unknown }

  // Cache hit (no conditional request in Phase 1 for simplicity; optional ETag below)
  if (ttlMs > 0) {
    const cached = getFromCache<T>(key)
    if (cached) {
      logInfo("github.cache_hit", logData({ key }))
      return cached.value
    }
  }

  const doFetch = () =>
    ghResponse(token, path, {
      method,
    })

  let lastRes: Response | null = null
  let attempt = 0

  while (true) {
    lastRes = await doFetch()
    const status = lastRes.status

    if (status === 200 || status === 201) {
      const body = await parseResponse(lastRes)
      const etag = lastRes.headers.get("etag") ?? undefined
      if (ttlMs > 0) setCache(key, body, ttlMs, etag)
      return body
    }

    if (status !== 403 && status !== 429 && status < 500) {
      const text = await lastRes.text().catch(() => "")
      throw new Error(`GitHub API error ${status}: ${text || lastRes.statusText}`)
    }

    const remaining = lastRes.headers.get("x-ratelimit-remaining")
    const reset = lastRes.headers.get("x-ratelimit-reset")
    const retryAfter = lastRes.headers.get("retry-after")
    const remainingNum = remaining !== null && remaining !== "" ? parseInt(remaining, 10) : null
    const resetTs = reset ? parseInt(reset, 10) : null

    if ((status === 403 || status === 429) && remainingNum === 0 && resetTs) {
      const waitMs = Math.min(
        Math.max(0, resetTs * 1000 - Date.now()),
        maxRateLimitWaitMs()
      )
      logWarn("github.rate_limited", undefined, logData({ wait_ms: waitMs, key }))
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
      attempt++
      if (attempt >= MAX_RETRIES) {
        const text = await lastRes.text().catch(() => "")
        throw new Error(`GitHub API rate limited ${status}: ${text || lastRes.statusText}`)
      }
      logWarn("github.retry", undefined, logData({ reason: "rate_limited", wait_ms: waitMs, attempt }))
      continue
    }

    if (retryAfter) {
      const waitMs = Math.min(parseInt(retryAfter, 10) * 1000 || 5000, maxRateLimitWaitMs())
      logWarn("github.retry", undefined, logData({ reason: "retry_after", wait_ms: waitMs, attempt: attempt + 1 }))
      await new Promise((r) => setTimeout(r, waitMs))
      attempt++
      if (attempt >= MAX_RETRIES) {
        const text = await lastRes.text().catch(() => "")
        throw new Error(`GitHub API error ${status}: ${text || lastRes.statusText}`)
      }
      continue
    }

    if (status >= 500 && attempt < MAX_RETRIES) {
      const backoff = TRANSIENT_BACKOFF_MS[attempt] ?? TRANSIENT_BACKOFF_MS[TRANSIENT_BACKOFF_MS.length - 1]
      logWarn("github.retry", undefined, logData({ reason: "transient", wait_ms: backoff, attempt: attempt + 1 }))
      await new Promise((r) => setTimeout(r, backoff))
      attempt++
      continue
    }

    const text = await lastRes.text().catch(() => "")
    throw new Error(`GitHub API error ${status}: ${text || lastRes.statusText}`)
  }
}
