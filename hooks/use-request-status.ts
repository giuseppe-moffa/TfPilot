import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { isActiveStatus, isTerminalStatus } from "@/lib/status/status-config"

type RequestLike = Record<string, any> | null

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const json = JSON.parse(text) as { message?: string; error?: string }
      message = json.message ?? json.error ?? text
    } catch {
      /* use text as-is */
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const json = await res.json()
  return json.request ?? json
}

/** Intervals (ms). Only detail page uses this hook and calls sync. */
const INTERVAL_ACTIVE_MS = 8_000
const INTERVAL_IDLE_MS = 25_000
const INTERVAL_TAB_HIDDEN_MS = 60_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 60_000

function getRefreshInterval(
  latest: RequestLike | null | undefined,
  tabHidden: boolean
): number {
  if (!latest) return INTERVAL_IDLE_MS
  if (tabHidden) return INTERVAL_TAB_HIDDEN_MS
  const status = (latest as any)?.status as string | undefined
  if (status && isTerminalStatus(status)) return 0
  if (status && isActiveStatus(status)) return INTERVAL_ACTIVE_MS
  return INTERVAL_IDLE_MS
}

export function useRequestStatus(requestId?: string, initial?: RequestLike) {
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false
  )
  useEffect(() => {
    const handler = () => setTabHidden(document.hidden)
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [])

  const refreshIntervalFn = useCallback(
    (latest: unknown) => getRefreshInterval(latest as RequestLike, tabHidden),
    [tabHidden]
  )

  const swr: any = useSWR(
    requestId ? `/api/requests/${requestId}/sync` : null,
    fetcher,
    {
      fallbackData: initial ?? null,
      keepPreviousData: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
      revalidateIfStale: true,
      revalidateOnMount: true,
      refreshInterval: refreshIntervalFn,
      onErrorRetry: (
        err: Error & { status?: number },
        _key: string,
        _config: unknown,
        revalidate: () => void,
        { retryCount }: { retryCount: number }
      ) => {
        if (err.status === 429 && retryCount < 5) {
          setTimeout(revalidate, BACKOFF_MAX_MS)
          return
        }
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, retryCount),
          BACKOFF_MAX_MS
        )
        if (retryCount < 8) setTimeout(revalidate, delay)
      },
    }
  )
  const { data, error, isValidating, mutate } = swr

  return {
    request: data ?? initial ?? null,
    error,
    isSyncing: isValidating,
    mutate,
  }
}
