import useSWR from "swr"

export const REQUEST_CACHE_KEY_PREFIX = "req:"

export function requestCacheKey(id: string | undefined): string | null {
  return id ? `${REQUEST_CACHE_KEY_PREFIX}${id}` : null
}

const syncFetcher = async (key: string) => {
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
  const json = await res.json()
  return json.request ?? json
}

type RequestLike = Record<string, any> | null

/**
 * Stable canonical request cache: one key per request (req:${id}) so table and detail share data.
 * Fetches from GET /api/requests/${id}/sync. All mutations should patch this same key.
 */
export function useRequest(requestId: string | undefined, initial?: RequestLike) {
  const key = requestCacheKey(requestId)
  const swr = useSWR(key, key ? syncFetcher : null, {
    fallbackData: initial ?? undefined,
    keepPreviousData: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
    revalidateIfStale: false,
    revalidateOnMount: false,
  })
  const { data, error, mutate } = swr
  const isValidating = "isValidating" in swr ? (swr as { isValidating: boolean }).isValidating : false
  const request: RequestLike = data ?? initial ?? null
  const revalidate = () => mutate(undefined, true)
  return {
    request,
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
