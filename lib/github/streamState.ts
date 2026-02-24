/**
 * S3-backed stream state for SSE: webhooks/github/stream.json
 * Webhook publishes events here; /api/stream reads and sends to clients.
 *
 * Note: read-modify-write may drop events under high concurrency; polling fallback covers this;
 * consider Dynamo/SQS later for stronger ordering/durability.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const STREAM_KEY = "webhooks/github/stream.json"
const MAX_EVENTS = 50

export type StreamEvent = {
  seq: number
  requestId: string
  updatedAt: string
  type: string
}

export type StreamState = {
  seq: number
  events: StreamEvent[]
}

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

/**
 * Read current stream state from S3. Returns { seq: 0, events: [] } if missing or invalid.
 */
export async function getStreamState(): Promise<StreamState> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: STREAM_KEY }))
    const body = await streamToString(res.Body as any)
    const data = JSON.parse(body) as { seq?: number; events?: StreamEvent[] }
    const events = Array.isArray(data.events) ? data.events : []
    const seq = typeof data.seq === "number" && Number.isFinite(data.seq) ? data.seq : 0
    return { seq, events }
  } catch {
    return { seq: 0, events: [] }
  }
}

/**
 * Append one event and persist. Seq is monotonic: max(Date.now(), last.seq+1). Trims to last MAX_EVENTS.
 */
export async function appendStreamEvent(event: {
  requestId: string
  updatedAt: string
  type: string
}): Promise<void> {
  const state = await getStreamState()
  const nextSeq = Math.max(Date.now(), state.seq + 1)
  const newEvent: StreamEvent = { seq: nextSeq, ...event }
  const events = [...state.events, newEvent].slice(-MAX_EVENTS)
  const payload: StreamState = { seq: nextSeq, events }
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: STREAM_KEY,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}
