import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { env } from "@/lib/config/env"

export type LifecycleEvent = {
  requestId: string
  event: string
  actor?: string
  source?: string
  data?: Record<string, unknown>
}

/** Completion lifecycle event names (plan/apply/destroy × succeeded/failed). */
export const COMPLETION_LIFECYCLE_EVENTS = [
  "plan_succeeded",
  "plan_failed",
  "apply_succeeded",
  "apply_failed",
  "destroy_succeeded",
  "destroy_failed",
] as const

export type CompletionLifecycleEventName = (typeof COMPLETION_LIFECYCLE_EVENTS)[number]

/** Data shape for completion events. */
export type CompletionEventData = {
  kind: "plan" | "apply" | "destroy"
  runId: number
  attempt: number
  conclusion: string
}

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET

function toKey(requestId: string, ts: string) {
  return `logs/${requestId}/${ts}.json`
}

async function streamToString(stream: unknown): Promise<string> {
  if (!stream || typeof (stream as NodeJS.ReadableStream).on !== "function") return ""
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    ;(stream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => chunks.push(chunk))
    ;(stream as NodeJS.ReadableStream).on("error", reject)
    ;(stream as NodeJS.ReadableStream).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

/**
 * Fetch lifecycle events for a request from S3 (logs/{requestId}/).
 * Used by audit-export and by completion-event dedupe.
 */
export async function fetchLifecycleEvents(requestId: string): Promise<Array<LifecycleEvent & { timestamp?: string }>> {
  const prefix = `logs/${requestId}/`
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: 500,
      })
    )
    const contents = (listed.Contents ?? []).sort(
      (a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0)
    )
    const events: Array<LifecycleEvent & { timestamp?: string }> = []
    for (const obj of contents) {
      if (!obj.Key) continue
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }))
      const text = await streamToString(res.Body)
      try {
        events.push(JSON.parse(text))
      } catch {
        events.push({ requestId, event: "unknown", raw: text } as LifecycleEvent & { timestamp?: string })
      }
    }
    return events
  } catch (error) {
    console.warn("[lifecycle] fetchLifecycleEvents failed", { requestId, error })
    return []
  }
}

export async function logLifecycleEvent(entry: LifecycleEvent) {
  const timestamp = new Date().toISOString()
  const payload = {
    timestamp,
    ...entry,
  }

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: toKey(entry.requestId, timestamp),
        Body: JSON.stringify(payload, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      })
    )
  } catch (error) {
    // Logging must not break the lifecycle; surface for visibility only.
    console.warn("[lifecycle-log] failed", { error, event: entry.event, requestId: entry.requestId })
  }
}

export type RunKind = "plan" | "apply" | "destroy"

/**
 * Emit a completion lifecycle event (plan_succeeded/failed, apply_succeeded/failed, destroy_succeeded/failed)
 * only if conclusion is present and we have not already emitted for this (kind + runId).
 * Idempotent: duplicate webhook or sync processing does not create duplicate events.
 */
export async function maybeEmitCompletionEvent(
  requestId: string,
  kind: RunKind,
  runId: number,
  attempt: number,
  conclusion: string,
  source: "webhook" | "sync",
  actor: string
): Promise<void> {
  if (!conclusion) return

  const eventName: CompletionLifecycleEventName =
    conclusion === "success" ? `${kind}_succeeded` : `${kind}_failed`

  const existing = await fetchLifecycleEvents(requestId)
  const alreadyEmitted = existing.some(
    (e) =>
      (e.event === `${kind}_succeeded` || e.event === `${kind}_failed`) &&
      (e.data as CompletionEventData | undefined)?.runId === runId
  )
  if (alreadyEmitted) return

  await logLifecycleEvent({
    requestId,
    event: eventName,
    actor,
    source,
    data: { kind, runId, attempt, conclusion } as CompletionEventData,
  })
}
