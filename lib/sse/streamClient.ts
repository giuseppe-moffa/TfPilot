/**
 * Shared SSE client for /api/stream. One connection per page; hooks subscribe to events and connection state.
 * Client-only (EventSource); safe to import from hooks.
 */

export type StreamRequestEvent = {
  seq: number
  requestId: string
  updatedAt: string
  type: string
}

type RequestEventHandler = (ev: StreamRequestEvent) => void
type ConnectionStateHandler = (connected: boolean) => void

let es: EventSource | null = null
let connected = false
/** Client-side since cursor: last event seq seen; used on (re)connect to replay from ring buffer. */
let lastSeq = 0
const requestHandlers = new Set<RequestEventHandler>()
const connectionStateHandlers = new Set<ConnectionStateHandler>()

function setConnected(value: boolean) {
  if (connected === value) return
  connected = value
  connectionStateHandlers.forEach((h) => h(connected))
}

function ensureConnection() {
  if (typeof window === "undefined") return
  if (es != null) return
  es = new EventSource(`/api/stream?since=${lastSeq}`)
  es.onopen = () => setConnected(true)
  es.onerror = () => {
    // Do NOT close(); keep ES open and rely on browser reconnect.
    setConnected(false)
  }
  es.addEventListener("request", (e: MessageEvent) => {
    try {
      const ev = JSON.parse(e.data) as StreamRequestEvent
      lastSeq = Math.max(lastSeq, ev.seq)
      requestHandlers.forEach((h) => h(ev))
    } catch {
      // ignore parse errors
    }
  })
}

/** Close EventSource only when explicitly unsubscribing with zero subscribers. */
function closeIfUnused() {
  if (requestHandlers.size > 0) return
  if (es) {
    es.close()
    es = null
    setConnected(false)
  }
}

/**
 * Subscribe to request events. Opens the EventSource if needed.
 * Returns unsubscribe function.
 */
export function subscribeToRequestEvents(handler: RequestEventHandler): () => void {
  requestHandlers.add(handler)
  ensureConnection()
  return () => {
    requestHandlers.delete(handler)
    closeIfUnused()
  }
}

/**
 * Subscribe to connection state changes (open / error / close).
 * Returns unsubscribe function.
 */
export function subscribeToConnectionState(handler: ConnectionStateHandler): () => void {
  connectionStateHandlers.add(handler)
  handler(connected)
  return () => connectionStateHandlers.delete(handler)
}

/**
 * Current connection state. Only accurate after at least one subscriber has been active.
 */
export function getConnectionState(): boolean {
  return connected
}

/**
 * Last event seq seen (since cursor). Used for reconnect URL; exposed for debugging.
 */
export function getLastSeq(): number {
  return lastSeq
}
