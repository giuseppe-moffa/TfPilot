import * as React from "react"
import useSWR from "swr"

type RequestLike = Record<string, any> | null

const WHITELIST_KEYS = [
  "status",
  "statusDerivedAt",
  "planRun",
  "applyRun",
  "approval",
  "pr",
  "plan",
  "cleanupPr",
  "timeline",
] as const

function mergeRequest(prev: RequestLike, next: RequestLike): RequestLike {
  if (!next) return prev
  if (!prev) return next

  const merged: any = { ...prev }

  for (const key of WHITELIST_KEYS) {
    if (key === "plan") {
      if (next.plan) {
        merged.plan = {
          ...(prev.plan ?? {}),
          ...(next.plan?.diff !== undefined ? { diff: next.plan.diff } : {}),
          ...(next.plan?.output !== undefined ? { output: next.plan.output } : {}),
        }
      }
      continue
    }
    if (next[key] !== undefined) {
      if (key === "planRun" || key === "applyRun" || key === "approval" || key === "pr" || key === "cleanupPr") {
        merged[key] = { ...(prev as any)[key], ...(next as any)[key] }
      } else {
        merged[key] = next[key]
      }
    }
  }

  return merged
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return json.request ?? json
}

export function useRequestStatus(requestId?: string, initial?: RequestLike) {
  const prevDataRef = React.useRef<RequestLike>(initial ?? null)
  const unchangedRef = React.useRef(0)

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
        const status = (latest as any)?.status ?? prevDataRef.current?.status
        if (status === "complete" || status === "failed") return 0
        return unchangedRef.current >= 3 ? 15000 : 5000
      },
      onSuccess: (latest: any) => {
        const prevString = JSON.stringify(prevDataRef.current ?? {})
        const nextString = JSON.stringify(latest ?? {})
        if (prevString === nextString) {
          unchangedRef.current += 1
        } else {
          unchangedRef.current = 0
        }
      },
    }
  )
  const { data, error, isValidating, mutate } = swr

  const merged = React.useMemo(() => {
    const nextMerged = mergeRequest(prevDataRef.current, data ?? null)
    prevDataRef.current = nextMerged
    return nextMerged
  }, [data])

  return {
    request: merged,
    error,
    isSyncing: isValidating,
    mutate,
  }
}
