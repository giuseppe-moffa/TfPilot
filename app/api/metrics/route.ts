import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { listRequests } from "@/lib/storage/requestsStore"

type MetricsResponse = {
  total: number
  statusCounts: Record<string, number>
  successRate: number | null
  failureCount: number
  destroyedCount: number
  avgApplySeconds: number | null
}

function toSeconds(ms: number) {
  return Math.round(ms / 1000)
}

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const requests = ((await listRequests(200)) ?? []) as Array<Record<string, any>>

  const statusCounts: Record<string, number> = {}
  const applyDurations: number[] = []
  let successCount = 0
  let failureCount = 0
  let destroyedCount = 0

  for (const req of requests) {
    const status = req.status ?? "unknown"
    statusCounts[status] = (statusCounts[status] ?? 0) + 1

    if (status === "complete" || status === "applied") successCount += 1
    if (status === "failed") failureCount += 1
    if (status === "destroyed") destroyedCount += 1

    if (req.applyTriggeredAt && req.appliedAt) {
      const start = Date.parse(req.applyTriggeredAt)
      const end = Date.parse(req.appliedAt)
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        applyDurations.push(toSeconds(end - start))
      }
    }
  }

  const total = requests.length
  const avgApplySeconds =
    applyDurations.length > 0
      ? Math.round(applyDurations.reduce((sum, n) => sum + n, 0) / applyDurations.length)
      : null
  const successRate = total > 0 ? successCount / total : null

  const metrics: MetricsResponse = {
    total,
    statusCounts,
    successRate,
    failureCount,
    destroyedCount,
    avgApplySeconds,
  }

  return NextResponse.json({ success: true, metrics })
}
