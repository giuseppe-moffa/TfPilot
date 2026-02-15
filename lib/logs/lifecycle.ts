import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

import { env } from "@/lib/config/env"

type LifecycleEvent = {
  requestId: string
  event: string
  actor?: string
  source?: string
  data?: Record<string, unknown>
}

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET

function toKey(requestId: string, ts: string) {
  return `logs/${requestId}/${ts}.json`
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
