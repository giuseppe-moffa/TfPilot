/**
 * Lightweight structured logger for production telemetry.
 * Console-only; no tokens, cookies, headers, or request bodies.
 */

export type LogData = {
  requestId?: string
  route?: string
  user?: string
  message?: string
  correlationId?: string
  duration_ms?: number
  [key: string]: unknown
}

function safeError(err: unknown): { name: string; message: string } | undefined {
  if (err instanceof Error) return { name: err.name, message: err.message }
  if (typeof err === "object" && err !== null && "message" in err)
    return { name: "Error", message: String((err as { message: unknown }).message) }
  return undefined
}

function buildPayload(
  level: "info" | "warn" | "error",
  event: string,
  error?: unknown,
  data?: LogData
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    level,
    event,
    timestamp: new Date().toISOString(),
  }
  if (data) {
    if (data.requestId != null) payload.requestId = data.requestId
    if (data.route != null) payload.route = data.route
    if (data.user != null) payload.user = data.user
    if (data.message != null) payload.message = data.message
    if (data.correlationId != null) payload.correlationId = data.correlationId
    if (data.duration_ms != null) payload.duration_ms = data.duration_ms
    const rest = { ...data }
    delete rest.requestId
    delete rest.route
    delete rest.user
    delete rest.message
    delete rest.correlationId
    delete rest.duration_ms
    Object.assign(payload, rest)
  }
  if (error !== undefined) payload.error = safeError(error)
  return payload
}

function write(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify(payload)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export function logInfo(event: string, data?: LogData): void {
  write("info", buildPayload("info", event, undefined, data))
}

export function logWarn(event: string, error?: unknown, data?: LogData): void {
  write("warn", buildPayload("warn", event, error, data))
}

export function logError(event: string, error?: unknown, data?: LogData): void {
  write("error", buildPayload("error", event, error, data))
}

/**
 * Runs an async operation, measures duration, and logs once on success or failure.
 * On success: logInfo(event, { ...data, duration_ms }).
 * On error: logError(event + "_failed", error, { ...data, duration_ms }) then rethrows.
 */
export async function timeAsync<T>(
  event: string,
  data: LogData,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    logInfo(event, { ...data, duration_ms: Date.now() - start })
    return result
  } catch (err) {
    logError(`${event}_failed`, err, { ...data, duration_ms: Date.now() - start })
    throw err
  }
}
