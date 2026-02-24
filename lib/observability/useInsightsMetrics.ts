"use client"

import useSWR from "swr"
import type { OpsMetricsPayload } from "@/lib/observability/ops-metrics"

type InsightsMetricsResponse = { success: boolean; metrics?: OpsMetricsPayload; error?: string }

const INSIGHTS_METRICS_URL = "/api/metrics/insights"
const REFRESH_INTERVAL_MS = 45_000

async function fetcher(url: string): Promise<OpsMetricsPayload> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as InsightsMetricsResponse).error ?? `Failed to load metrics (${res.status})`)
  }
  const data = (await res.json()) as InsightsMetricsResponse
  if (!data.success || !data.metrics) throw new Error("Invalid metrics response")
  return data.metrics
}

export function useInsightsMetrics() {
  const swr = useSWR(INSIGHTS_METRICS_URL, fetcher, {
    refreshInterval: REFRESH_INTERVAL_MS,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  })
  return {
    metrics: swr.data ?? null,
    isLoading: swr.isLoading,
    isValidating: "isValidating" in swr ? (swr as { isValidating: boolean }).isValidating : false,
    error: swr.error,
    mutate: swr.mutate,
  }
}
