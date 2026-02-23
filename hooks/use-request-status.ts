import useSWR from "swr"

type RequestLike = Record<string, any> | null

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return json.request ?? json
}

/** Terminal statuses: stop polling when API returns one of these. */
const TERMINAL_STATUSES = ["applied", "complete", "failed", "destroyed"]

export function useRequestStatus(requestId?: string, initial?: RequestLike) {
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
      refreshInterval: (latest: unknown): number => {
        if (!requestId) return 0
        const status = (latest as any)?.status
        if (status && TERMINAL_STATUSES.includes(status)) return 0
        return 3000
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
