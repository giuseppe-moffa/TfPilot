import crypto from "node:crypto"

/**
 * Request-like type that has url and optional nextUrl (NextRequest).
 */
type RequestLike = { url: string; headers?: Headers; nextUrl?: { pathname: string } }

/**
 * Returns a correlation id for the request: use x-correlation-id header if present,
 * otherwise generate a short id. Internal-only; not sent back to clients.
 */
export function getCorrelationId(req: RequestLike): string {
  const header = req.headers?.get?.("x-correlation-id")
  if (typeof header === "string" && header.trim()) return header.trim()
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16)
}

/**
 * Gets pathname from Request or NextRequest.
 */
function getPathname(req: RequestLike): string {
  if (req.nextUrl?.pathname) return req.nextUrl.pathname
  try {
    return new URL(req.url).pathname
  } catch {
    return req.url || ""
  }
}

export type CorrelationData = { correlationId: string; route: string }

/**
 * Attaches correlationId and route (pathname) to the given data object.
 * Use when building log payloads so all logs can include correlation context.
 */
export function withCorrelation<T extends Record<string, unknown>>(
  req: RequestLike,
  data: T
): T & CorrelationData {
  return {
    ...data,
    correlationId: getCorrelationId(req),
    route: getPathname(req),
  }
}
