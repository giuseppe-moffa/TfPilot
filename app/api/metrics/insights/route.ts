import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { buildOpsMetrics, type OpsMetricsPayload } from "@/lib/observability/ops-metrics"
import { listRequests } from "@/lib/storage/requestsStore"

/**
 * In-memory cache for insights metrics. TTL 60 seconds.
 * Key: single key "default" (no project/env filter yet). Ensures cold-cache < 3s, warm < 1s.
 */
const CACHE_TTL_MS = 60_000
const INSIGHTS_LIST_CAP = 1000

let cache: { payload: OpsMetricsPayload; cachedAt: number } | null = null

function getCached(): OpsMetricsPayload | null {
  if (!cache) return null
  if (Date.now() - cache.cachedAt >= CACHE_TTL_MS) {
    cache = null
    return null
  }
  return {
    ...cache.payload,
    cacheAgeSeconds: Math.round((Date.now() - cache.cachedAt) / 1000),
  }
}

function setCache(payload: OpsMetricsPayload) {
  cache = { payload, cachedAt: Date.now() }
}

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const cached = getCached()
  if (cached) {
    return NextResponse.json({ success: true, metrics: cached })
  }

  const generatedAt = new Date().toISOString()
  const requests = (await listRequests(INSIGHTS_LIST_CAP)) ?? []
  const metrics = buildOpsMetrics(requests as Parameters<typeof buildOpsMetrics>[0], generatedAt)
  setCache(metrics)

  return NextResponse.json({
    success: true,
    metrics: { ...metrics, cacheAgeSeconds: 0 },
  })
}
