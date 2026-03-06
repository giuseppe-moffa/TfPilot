import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { listRequestIndexRowsPage } from "@/lib/db/requestsList"
import { buildOpsMetrics, type OpsMetricsPayload } from "@/lib/observability/ops-metrics"
import { getRequest } from "@/lib/storage/requestsStore"

/**
 * In-memory cache for insights metrics. TTL 60 seconds.
 * Key: orgId. Ensures cold-cache < 3s, warm < 1s.
 */
const CACHE_TTL_MS = 60_000
const INSIGHTS_LIST_CAP = 1000

const cacheByOrg = new Map<string, { payload: OpsMetricsPayload; cachedAt: number }>()

function getCached(orgId: string): OpsMetricsPayload | null {
  const entry = cacheByOrg.get(orgId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt >= CACHE_TTL_MS) {
    cacheByOrg.delete(orgId)
    return null
  }
  return {
    ...entry.payload,
    cacheAgeSeconds: Math.round((Date.now() - entry.cachedAt) / 1000),
  }
}

function setCache(orgId: string, payload: OpsMetricsPayload) {
  cacheByOrg.set(orgId, { payload, cachedAt: Date.now() })
}

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ success: false, error: "No org context" }, { status: 403 })
  }

  const orgId = session.orgId
  const cached = getCached(orgId)
  if (cached) {
    return NextResponse.json({ success: true, metrics: cached })
  }

  let indexRows: Awaited<ReturnType<typeof listRequestIndexRowsPage>>
  try {
    indexRows = await listRequestIndexRowsPage({ orgId, limit: INSIGHTS_LIST_CAP, cursor: null })
  } catch (err) {
    console.error("[metrics/insights] Postgres query failed:", err)
    return NextResponse.json(
      { success: false, error: "Database unavailable" },
      { status: 503 }
    )
  }
  if (indexRows === null) {
    return NextResponse.json(
      { success: false, error: "Database not configured; insights require Postgres" },
      { status: 503 }
    )
  }

  const requests: Parameters<typeof buildOpsMetrics>[0] = []
  for (const row of indexRows) {
    try {
      const doc = await getRequest(row.request_id)
      requests.push(doc)
    } catch (e) {
      const err = e as { name?: string }
      if (err?.name === "NoSuchKey") {
        console.warn("[metrics/insights] missing doc for request_id:", row.request_id)
      } else {
        console.warn("[metrics/insights] getRequest failed:", row.request_id, (e as Error)?.message ?? e)
      }
    }
  }

  const generatedAt = new Date().toISOString()
  const metrics = buildOpsMetrics(requests, generatedAt)
  setCache(orgId, metrics)

  return NextResponse.json({
    success: true,
    metrics: { ...metrics, cacheAgeSeconds: 0 },
  })
}
