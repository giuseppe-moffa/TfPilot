/**
 * In-memory GitHub API usage and rate-limit metrics.
 * Rolling windows (5m / 60m) bucketed by minute; last-seen rate-limit headers.
 * No DB; resets on deploy/restart. Used by monitoring card and optional API.
 */

const BUCKETS_MAX = 60
const MS_PER_MINUTE = 60_000
const TOP_ROUTES_N = 8
const HOT_ROUTES_5M_N = 5
const RATE_LIMIT_EVENTS_MAX = 20

/**
 * Best-effort guess of route "kind" from normalized path (e.g. "pr", "run", "reviews").
 */
export function inferKindGuess(route: string): string | undefined {
  if (route.includes("/actions/runs/")) return "run"
  if (route.includes("/actions/workflows/")) return "workflow"
  if (route.includes("/pulls/")) return "pr"
  if (route.includes("/reviews")) return "reviews"
  if (route.includes("/jobs/")) return "jobs"
  if (route.includes("/contents/")) return "contents"
  if (route.includes("/dispatches")) return "dispatch"
  if (route.includes("/commits/")) return "commits"
  return undefined
}

/** Normalize path for grouping: strip query, replace numeric segments with :id, 40-char hex with :sha. Owner/repo kept as-is. */
export function normalizeRouteKey(routeKey: string): string {
  const path = routeKey.split("?")[0].trim() || "/"
  const segments = path.split("/").filter(Boolean)
  const out = segments.map((seg) => {
    if (/^\d+$/.test(seg)) return ":id"
    if (/^[a-f0-9]{40}$/i.test(seg)) return ":sha"
    return seg
  })
  return "/" + out.join("/")
}

export type GitHubCallRecord = {
  status: number
  remaining: number | null
  reset: number | null
  limit: number | null
  retryAfter: number | null
  durationMs: number
  routeKey?: string
  /** True when response was 403/429 with rate-limit indication or body indicates secondary rate limit. */
  rateLimited?: boolean
  /** Set when fetch() threw (no response); enables separate fetch_error count in windows. */
  errorType?: "fetch"
}

type Bucket = {
  calls_total: number
  calls_2xx: number
  calls_4xx: number
  calls_5xx: number
  calls_rate_limited: number
  calls_fetch_error: number
}

type RouteBucket = {
  calls_total: number
  calls_2xx: number
  calls_4xx: number
  calls_5xx: number
  calls_rate_limited: number
}

function emptyRouteBucket(): RouteBucket {
  return {
    calls_total: 0,
    calls_2xx: 0,
    calls_4xx: 0,
    calls_5xx: 0,
    calls_rate_limited: 0,
  }
}

function emptyBucket(): Bucket {
  return {
    calls_total: 0,
    calls_2xx: 0,
    calls_4xx: 0,
    calls_5xx: 0,
    calls_rate_limited: 0,
    calls_fetch_error: 0,
  }
}

/** Minute epoch (UTC) for a timestamp. */
function minuteEpoch(ts: number): number {
  return Math.floor(ts / MS_PER_MINUTE)
}

type MetricsStore = {
  buckets: Map<number, Bucket>
  routeBucketsByMinute: Map<number, Map<string, RouteBucket>>
  rateLimitEvents: Array<{
    at: string
    status: number
    route: string
    remaining: number | null
    limit: number | null
    reset: number | null
    retryAfter: number | null
    kindGuess?: string
  }>
  lastSeen: {
    remaining: number | null
    reset: number | null
    limit: number | null
    retryAfter: number | null
    observedAt: string | null
  }
}

const GLOBAL_KEY = "__tfpilot_github_metrics_store"

function getStore(): MetricsStore {
  const g = typeof globalThis !== "undefined" ? globalThis : ({} as Record<string, unknown>)
  let store = (g as Record<string, MetricsStore | undefined>)[GLOBAL_KEY]
  if (!store) {
    store = {
      buckets: new Map<number, Bucket>(),
      routeBucketsByMinute: new Map<number, Map<string, RouteBucket>>(),
      rateLimitEvents: [],
      lastSeen: {
        remaining: null,
        reset: null,
        limit: null,
        retryAfter: null,
        observedAt: null,
      },
    }
    ;(g as Record<string, MetricsStore>)[GLOBAL_KEY] = store
  }
  return store
}

function pruneOldBuckets(store: MetricsStore, now: number) {
  const cutoff = minuteEpoch(now) - (BUCKETS_MAX - 1)
  for (const key of store.buckets.keys()) {
    if (key < cutoff) store.buckets.delete(key)
  }
  for (const key of store.routeBucketsByMinute.keys()) {
    if (key < cutoff) store.routeBucketsByMinute.delete(key)
  }
}

function getOrCreateRouteBucket(store: MetricsStore, minEpoch: number, route: string): RouteBucket {
  let byRoute = store.routeBucketsByMinute.get(minEpoch)
  if (!byRoute) {
    byRoute = new Map()
    store.routeBucketsByMinute.set(minEpoch, byRoute)
  }
  let b = byRoute.get(route)
  if (!b) {
    b = emptyRouteBucket()
    byRoute.set(route, b)
  }
  return b
}

function getOrCreateBucket(store: MetricsStore, minEpoch: number): Bucket {
  let b = store.buckets.get(minEpoch)
  if (!b) {
    b = emptyBucket()
    store.buckets.set(minEpoch, b)
  }
  return b
}

/**
 * Record a single GitHub API call for metrics.
 * Must be called exactly once per real network response.
 * Instrument only ghResponse() in lib/github/client.ts — do not call from gh() or
 * githubRequest(); both use ghResponse(), so recording there would double-count.
 * Cache hits in githubRequest() never call ghResponse(), so they are correctly not recorded.
 */
export function recordGitHubCall(r: GitHubCallRecord): void {
  const store = getStore()
  const now = Date.now()
  pruneOldBuckets(store, now)
  const key = minuteEpoch(now)
  const b = getOrCreateBucket(store, key)

  b.calls_total += 1
  if (r.status >= 200 && r.status < 300) b.calls_2xx += 1
  else if (r.status >= 400 && r.status < 500) b.calls_4xx += 1
  else if (r.status >= 500) b.calls_5xx += 1
  if (r.rateLimited) b.calls_rate_limited += 1
  if (r.errorType === "fetch") b.calls_fetch_error += 1

  if (r.remaining !== null && r.remaining !== undefined) store.lastSeen.remaining = r.remaining
  if (r.reset !== null && r.reset !== undefined) store.lastSeen.reset = r.reset
  if (r.limit !== null && r.limit !== undefined) store.lastSeen.limit = r.limit
  if (r.retryAfter !== null && r.retryAfter !== undefined) store.lastSeen.retryAfter = r.retryAfter
  if (r.errorType !== "fetch") store.lastSeen.observedAt = new Date(now).toISOString()

  if (r.routeKey) {
    const route = normalizeRouteKey(r.routeKey)
    const rb = getOrCreateRouteBucket(store, key, route)
    rb.calls_total += 1
    if (r.status >= 200 && r.status < 300) rb.calls_2xx += 1
    else if (r.status >= 400 && r.status < 500) rb.calls_4xx += 1
    else if (r.status >= 500) rb.calls_5xx += 1
    if (r.rateLimited) rb.calls_rate_limited += 1
  }

  if (r.rateLimited && r.routeKey) {
    const route = normalizeRouteKey(r.routeKey)
    store.rateLimitEvents.unshift({
      at: new Date(now).toISOString(),
      status: r.status,
      route,
      remaining: r.remaining ?? null,
      limit: r.limit ?? null,
      reset: r.reset ?? null,
      retryAfter: r.retryAfter ?? null,
      kindGuess: inferKindGuess(route),
    })
    if (store.rateLimitEvents.length > RATE_LIMIT_EVENTS_MAX) store.rateLimitEvents.length = RATE_LIMIT_EVENTS_MAX
  }
}

/** Sum buckets over the last N minutes. */
function sumLastNMinutes(store: MetricsStore, now: number, n: number): Bucket {
  const out = emptyBucket()
  const start = minuteEpoch(now) - n + 1
  for (let i = 0; i < n; i++) {
    const b = store.buckets.get(start + i)
    if (b) {
      out.calls_total += b.calls_total
      out.calls_2xx += b.calls_2xx
      out.calls_4xx += b.calls_4xx
      out.calls_5xx += b.calls_5xx
      out.calls_rate_limited += b.calls_rate_limited
      out.calls_fetch_error += b.calls_fetch_error
    }
  }
  return out
}

export type GitHubMetricsWindow = {
  calls: number
  rateLimited: number
  success: number
  clientError: number
  serverError: number
  fetchError: number
}

export type TopRouteRow = {
  route: string
  calls: number
  rateLimited: number
  success: number
  clientError: number
  serverError: number
}

export type RateLimitEventRow = {
  at: string
  status: number
  route: string
  remaining: number | null
  limit: number | null
  reset: number | null
  retryAfter: number | null
  kindGuess?: string
}

/** Same shape as TopRouteRow; top routes in last 5 minutes. */
export type HotRouteRow = TopRouteRow

export type GitHubMetricsSnapshot = {
  window5m: GitHubMetricsWindow
  window60m: GitHubMetricsWindow
  lastSeen: {
    remaining: number | null
    reset: number | null
    limit: number | null
    retryAfter: number | null
    observedAt: string | null
  }
  /** Top N normalized routes by call count in last 60m. */
  topRoutes60m?: TopRouteRow[]
  /** Top 5 normalized routes by call count in last 5m. */
  hotRoutes5m?: HotRouteRow[]
  /** True if 5m window had rate limits or remaining/limit < 10%. */
  rateLimitBurst5m?: boolean
  /** Last M rate-limit events (newest first). */
  rateLimitEvents?: RateLimitEventRow[]
}

function bucketToWindow(b: Bucket): GitHubMetricsWindow {
  return {
    calls: b.calls_total,
    rateLimited: b.calls_rate_limited,
    success: b.calls_2xx,
    clientError: b.calls_4xx,
    serverError: b.calls_5xx,
    fetchError: b.calls_fetch_error,
  }
}

/** Sum route buckets over last N minutes, return Map<route, RouteBucket>. */
function sumRouteBucketsLastNMinutes(store: MetricsStore, now: number, n: number): Map<string, RouteBucket> {
  const agg = new Map<string, RouteBucket>()
  const start = minuteEpoch(now) - n + 1
  for (let i = 0; i < n; i++) {
    const byRoute = store.routeBucketsByMinute.get(start + i)
    if (!byRoute) continue
    for (const [route, b] of byRoute) {
      let cur = agg.get(route)
      if (!cur) {
        cur = emptyRouteBucket()
        agg.set(route, cur)
      }
      cur.calls_total += b.calls_total
      cur.calls_2xx += b.calls_2xx
      cur.calls_4xx += b.calls_4xx
      cur.calls_5xx += b.calls_5xx
      cur.calls_rate_limited += b.calls_rate_limited
    }
  }
  return agg
}

/**
 * Return aggregated metrics for the last 5m, last 60m, and last-seen rate-limit headers.
 */
export function getGitHubMetricsSnapshot(): GitHubMetricsSnapshot {
  const store = getStore()
  const now = Date.now()
  pruneOldBuckets(store, now)
  const w5 = sumLastNMinutes(store, now, 5)
  const w60 = sumLastNMinutes(store, now, 60)

  const routeAgg60 = sumRouteBucketsLastNMinutes(store, now, 60)
  const topRoutes60m: TopRouteRow[] = [...routeAgg60.entries()]
    .sort((a, b) => b[1].calls_total - a[1].calls_total)
    .slice(0, TOP_ROUTES_N)
    .map(([route, b]) => ({
      route,
      calls: b.calls_total,
      rateLimited: b.calls_rate_limited,
      success: b.calls_2xx,
      clientError: b.calls_4xx,
      serverError: b.calls_5xx,
    }))

  const routeAgg5 = sumRouteBucketsLastNMinutes(store, now, 5)
  const hotRoutes5m: HotRouteRow[] = [...routeAgg5.entries()]
    .sort((a, b) => b[1].calls_total - a[1].calls_total)
    .slice(0, HOT_ROUTES_5M_N)
    .map(([route, b]) => ({
      route,
      calls: b.calls_total,
      rateLimited: b.calls_rate_limited,
      success: b.calls_2xx,
      clientError: b.calls_4xx,
      serverError: b.calls_5xx,
    }))

  const last = store.lastSeen
  const rateLimitBurst5m =
    w5.calls_rate_limited > 0 ||
    (last.remaining != null &&
      last.limit != null &&
      last.limit > 0 &&
      last.remaining / last.limit < 0.1)

  const rateLimitEventsSnapshot: RateLimitEventRow[] = store.rateLimitEvents.slice(0, RATE_LIMIT_EVENTS_MAX)

  return {
    window5m: bucketToWindow(w5),
    window60m: bucketToWindow(w60),
    lastSeen: { ...store.lastSeen },
    topRoutes60m,
    hotRoutes5m,
    rateLimitBurst5m,
    rateLimitEvents: rateLimitEventsSnapshot,
  }
}
