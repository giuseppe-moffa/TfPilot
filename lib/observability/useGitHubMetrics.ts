"use client"

import useSWR from "swr"
import type { GitHubMetricsSnapshot } from "@/lib/observability/github-metrics"

const GITHUB_METRICS_URL = "/api/metrics/github"
const REFRESH_INTERVAL_MS = 10_000

async function fetcher(url: string): Promise<GitHubMetricsSnapshot> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" })
  if (res.status === 401) {
    const err = new Error("Not authenticated") as Error & { status?: number }
    err.status = 401
    throw err
  }
  if (!res.ok) {
    throw new Error(`Failed to load GitHub metrics (${res.status})`)
  }
  return res.json() as Promise<GitHubMetricsSnapshot>
}

export function useGitHubMetrics() {
  const swr = useSWR(GITHUB_METRICS_URL, fetcher, {
    refreshInterval: REFRESH_INTERVAL_MS,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  })
  const error = swr.error as (Error & { status?: number }) | undefined
  return {
    data: swr.data ?? null,
    isLoading: swr.isLoading,
    isValidating: "isValidating" in swr ? (swr as { isValidating: boolean }).isValidating : false,
    error,
    mutate: swr.mutate,
  }
}
