"use client"

import { useEffect, useRef } from "react"
import * as SWRModule from "swr"
import { requestCacheKey } from "@/hooks/use-request"
import { subscribeToRequestEvents } from "./streamClient"

const LIST_CACHE_KEY = "/api/requests"
/** Coalesce list revalidations when SSE emits many events in a short burst (e.g. webhook retries). */
const LIST_MUTATE_DEBOUNCE_MS = 300

const globalMutate = (SWRModule as unknown as { mutate: (key: string) => Promise<unknown> }).mutate

/**
 * Single subscription to request SSE events. Mounted in root layout (stable across route
 * transitions) so there is exactly one subscriber and no duplicate event=sse.request_updated.
 * - Per-request key (req:${requestId}): mutated immediately (cheap, targeted).
 * - List key (/api/requests): debounced by LIST_MUTATE_DEBOUNCE_MS so bursty events don't
 *   spam the list endpoint.
 */
export function RequestStreamRevalidator() {
  const listMutateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsub = subscribeToRequestEvents((ev) => {
      const requestKey = requestCacheKey(ev.requestId)
      if (requestKey) void globalMutate(requestKey)

      if (listMutateTimeoutRef.current != null) clearTimeout(listMutateTimeoutRef.current)
      listMutateTimeoutRef.current = setTimeout(() => {
        listMutateTimeoutRef.current = null
        void globalMutate(LIST_CACHE_KEY)
      }, LIST_MUTATE_DEBOUNCE_MS)

      if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEBUG_SSE === "1") {
        // eslint-disable-next-line no-console
        console.log("event=sse.request_updated", {
          requestId: ev.requestId,
          listMutate: LIST_CACHE_KEY,
          requestKey: requestKey ?? null,
        })
      }
    })
    return () => {
      unsub()
      if (listMutateTimeoutRef.current != null) {
        clearTimeout(listMutateTimeoutRef.current)
        listMutateTimeoutRef.current = null
      }
    }
  }, [])
  return null
}
