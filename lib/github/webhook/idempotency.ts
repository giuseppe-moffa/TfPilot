import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/deliveries/"

function deliveryKey(deliveryId: string): string {
  return `${PREFIX}${deliveryId}.json`
}

/**
 * Check if we have already processed this delivery (idempotency).
 */
export async function hasDelivery(deliveryId: string): Promise<boolean> {
  if (!deliveryId) return false
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: deliveryKey(deliveryId),
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Record a delivery as processed. Store minimal metadata for idempotency and debugging.
 */
export async function recordDelivery(deliveryId: string, event: string): Promise<void> {
  if (!deliveryId) return
  const body = JSON.stringify(
    { deliveryId, event, receivedAt: new Date().toISOString() },
    null,
    2
  )
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: deliveryKey(deliveryId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}
