import React from "react"
import useSWR from "swr"
import * as SWRModule from "swr"
import { getSyncPollingInterval } from "@/lib/config/polling"

const globalMutate = (SWRModule as unknown as { mutate: (key: string) => Promise<unknown> }).mutate
import {
  subscribeToRequestEvents,
  subscribeToConnectionState,
} from "@/lib/sse/streamClient"

export const REQUEST_CACHE_KEY_PREFIX = "req:"

export function requestCacheKey(id: string | undefined): string | null {
  return id ? `${REQUEST_CACHE_KEY_PREFIX}${id}` : null
}

export type SyncMeta = {
  mode?: string
  degraded?: boolean
  retryAfterMs?: number
  reason?: string
  scope?: "repo" | "global"
}

export type SyncResponse = { success: true; request: RequestLike; sync: SyncMeta }

const syncFetcher = async (key: string): Promise<SyncResponse> => {
  const id = key.startsWith(REQUEST_CACHE_KEY_PREFIX) ? key.slice(REQUEST_CACHE_KEY_PREFIX.length) : key
  const res = await fetch(`/api/requests/${id}/sync`, { cache: "no-store" })
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
  const json = (await res.json()) as { success?: boolean; request: RequestLike; sync?: SyncMeta }
  if (!json.request) throw new Error("Invalid sync response: missing request")
  return { success: true, request: json.request, sync: json.sync ?? { mode: "tfpilot-only" } }
}

type RequestLike = Record<string, any> | null

function isApplyOrDestroyRunActive(request: RequestLike): boolean {
  if (!request) return false
  const apply = request.applyRun
  const destroy = request.destroyRun
  const applyActive =
    (apply?.status === "queued" || apply?.status === "in_progress") && apply?.conclusion == null
  const destroyActive =
    (destroy?.status === "queued" || destroy?.status === "in_progress") && destroy?.conclusion == null
  return Boolean(applyActive || destroyActive)
}

/**
 * Stable canonical request cache: one key per request (req:${id}) so table and detail share data.
 * Fetches from GET /api/requests/${id}/sync. All mutations should patch this same key.
 * Idle polling via refreshInterval when not apply/destroy active; active-run polling is left to the page.
 */
const SSE_BACKOFF_MS = 60_000

export function useRequest(requestId: string | undefined, initial?: RequestLike) {
  const key = requestCacheKey(requestId)
  const [tabHidden, setTabHidden] = React.useState(
    typeof document !== "undefined" ? document.hidden : false
  )
  const [sseConnected, setSseConnected] = React.useState(false)
  React.useEffect(() => {
    const handler = () => setTabHidden(document.hidden)
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [])
  React.useEffect(() => {
    const unsubEvents = subscribeToRequestEvents((ev) => {
      const k = requestCacheKey(ev.requestId)
      if (k) void globalMutate(k)
      void globalMutate("/api/requests")
    })
    const unsubConn = subscribeToConnectionState(setSseConnected)
    return () => {
      unsubEvents()
      unsubConn()
    }
  }, [])
  const swr = useSWR(key, key ? syncFetcher : null, {
    fallbackData: initial != null ? { success: true, request: initial, sync: {} } : undefined,
    keepPreviousData: true,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshInterval: (latestData: SyncResponse | undefined) => {
      if (!latestData?.request) return getSyncPollingInterval(null, tabHidden)
      if (latestData.sync?.degraded && (latestData.sync?.retryAfterMs ?? 0) > 0) {
        return latestData.sync.retryAfterMs!
      }
      if (isApplyOrDestroyRunActive(latestData.request)) return 0
      const base = getSyncPollingInterval(latestData.request, tabHidden)
      if (sseConnected) return Math.max(base, SSE_BACKOFF_MS)
      return base
    },
  })
  const { data, error, mutate } = swr
  const isValidating = "isValidating" in swr ? (swr as { isValidating: boolean }).isValidating : false
  const request: RequestLike = data?.request ?? initial ?? null
  const syncMeta = data?.sync
  const revalidate = () => mutate(undefined, true)
  return {
    request,
    sync: syncMeta,
    error,
    mutate,
    revalidate,
    isSyncing: isValidating,
    hasSyncedOnce: data !== undefined,
  }
}

/** Patch canonical cache from outside (e.g. table after sync). Use for instant UI without refetch. */
export async function patchRequestCache(id: string, request: unknown): Promise<void> {
  const k = requestCacheKey(id)
  if (!k) return
  const swr = await import("swr")
  const m = (swr as { mutate?: (k: string, d?: unknown, o?: { revalidate?: boolean }) => Promise<unknown> }).mutate
  if (m) await m(k, request, { revalidate: false })
}
