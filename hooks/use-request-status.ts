import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import {
  getSyncPollingInterval,
  SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS,
} from "@/lib/config/polling"
import {
  subscribeToRequestEvents,
  subscribeToConnectionState,
} from "@/lib/sse/streamClient"

type GlobalMutator = (key: string, data?: unknown, opts?: { revalidate?: boolean }) => Promise<unknown>

type RequestLike = Record<string, any> | null

export type SyncMeta = {
  mode?: string
  degraded?: boolean
  retryAfterMs?: number
  reason?: string
  scope?: "repo" | "global"
}

export type SyncResponseShape = { success: true; request: RequestLike; sync?: SyncMeta }

const fetcher = async (url: string): Promise<SyncResponseShape> => {
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
  const json = (await res.json()) as { success?: boolean; request: RequestLike; sync?: SyncMeta }
  if (!json.request) throw new Error("Invalid sync response: missing request")
  return { success: true, request: json.request, sync: json.sync ?? {} }
}

const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 60_000
const SSE_BACKOFF_MS = 60_000

export function useRequestStatus(requestId?: string, initial?: RequestLike) {
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false
  )
  const [sseConnected, setSseConnected] = useState(false)
  const [nonce, setNonce] = useState(0)
  const errorRef = useRef<Error & { status?: number } | null>(null)
  const tabHiddenRef = useRef(tabHidden)
  tabHiddenRef.current = tabHidden
  const pendingForceSyncRef = useRef<(() => void) | null>(null)
  /** Keep last non-null request so we don't fall back to stale initialRequest when nonce changes and SWR data is briefly undefined. */
  const lastGoodRequestRef = useRef<RequestLike | null>(null)
  const prevRequestIdRef = useRef(requestId)
  const globalMutateRef = useRef<GlobalMutator | null>(null)
  if (prevRequestIdRef.current !== requestId) {
    prevRequestIdRef.current = requestId
    lastGoodRequestRef.current = null
  }

  useEffect(() => {
    const handler = () => setTabHidden(document.hidden)
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [])

  const mutateRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const unsubEvents = subscribeToRequestEvents((ev) => {
      if (ev.requestId === requestId) mutateRef.current?.()
    })
    const unsubConn = subscribeToConnectionState(setSseConnected)
    return () => {
      unsubEvents()
      unsubConn()
    }
  }, [requestId])

  const key = requestId ? `/api/requests/${requestId}/sync?nonce=${nonce}` : null
  const prevNonceRef = useRef<number>(nonce)
  if (prevNonceRef.current !== nonce) {
    prevNonceRef.current = nonce
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "development" && requestId) {
      // eslint-disable-next-line no-console
      console.log("[apply debug] SWR key changed, nonce:", nonce, "key:", key)
    }
  }
  const swr: any = useSWR(
    key,
    fetcher,
    {
      fallbackData: initial != null ? { success: true as const, request: initial, sync: undefined } : undefined,
      keepPreviousData: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
      revalidateIfStale: true,
      revalidateOnMount: true,
      refreshInterval: (latest: SyncResponseShape | undefined) => {
        if (errorRef.current?.status === 429) {
          return SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS
        }
        if (latest?.sync?.degraded && (latest.sync?.retryAfterMs ?? 0) > 0) {
          return latest.sync.retryAfterMs!
        }
        const base = getSyncPollingInterval(
          latest?.request ?? null,
          tabHiddenRef.current
        )
        if (sseConnected) return Math.max(base, SSE_BACKOFF_MS)
        return base
      },
      onErrorRetry: (
        err: Error & { status?: number },
        _key: string,
        _config: unknown,
        revalidate: () => void,
        { retryCount }: { retryCount: number }
      ) => {
        if (err.status === 429 && retryCount < 5) {
          setTimeout(revalidate, SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS)
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
  mutateRef.current = mutate
  errorRef.current = error ?? null
  if (data?.request != null) lastGoodRequestRef.current = data.request

  useEffect(() => {
    if (pendingForceSyncRef.current && !isValidating) {
      pendingForceSyncRef.current()
      pendingForceSyncRef.current = null
    }
  }, [data, isValidating])

  /** Bump nonce to force a fresh /sync fetch (bypasses deduping). Returns a promise that resolves when that fetch completes. */
  function forceSync(): Promise<void> {
    return new Promise((resolve) => {
      pendingForceSyncRef.current = resolve
      setNonce((n) => n + 1)
    })
  }

  /** Patch current and next (nonce+1) SWR keys so after forceSync() the UI keeps showing the patched request (e.g. runs/lock). */
  async function patchCurrentAndNextKey(patched: RequestLike): Promise<void> {
    if (!patched || !requestId) return
    if (!globalMutateRef.current) {
      const swr = await import("swr")
      globalMutateRef.current = (swr as { mutate?: GlobalMutator }).mutate ?? null
    }
    const m = globalMutateRef.current
    if (!m) return
    const payload: SyncResponseShape = { success: true, request: patched, sync: data?.sync }
    const opts = { revalidate: false }
    if (key) await m(key, payload, opts)
    const nextKey = `/api/requests/${requestId}/sync?nonce=${nonce + 1}`
    await m(nextKey, payload, opts)
  }

  /** True after at least one successful response from the sync endpoint (not just fallback). */
  const hasSyncedOnce = data !== undefined

  return {
    request: data?.request ?? lastGoodRequestRef.current ?? initial ?? null,
    error,
    isSyncing: isValidating,
    hasSyncedOnce,
    mutate,
    forceSync,
    patchCurrentAndNextKey,
    /** Exact SWR key (includes nonce) for debugging or external cache updates. */
    swrKey: key,
  }
}
