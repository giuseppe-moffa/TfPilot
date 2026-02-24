/**
 * S3-backed rate limit backoff per repo (or global) so /sync can return degraded without calling GitHub.
 * Key: webhooks/github/ratelimit/{owner}_{repo}.json or webhooks/github/ratelimit/global.json
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/ratelimit/"

function rateLimitKey(owner?: string, repo?: string): string {
  if (owner && repo) {
    const safe = `${String(owner)}_${String(repo)}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return `${PREFIX}${safe}.json`
  }
  return `${PREFIX}global.json`
}

type Payload = {
  until: string
  setAt: string
  retryAfterMs: number
  reason?: string
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
 * Returns current backoff for the given repo (or global) if we're still within it.
 * Call before making GitHub calls. Pass owner/repo from request.targetOwner/targetRepo.
 */
export async function getRateLimitBackoff(
  owner?: string,
  repo?: string
): Promise<{ until?: string; retryAfterMs?: number }> {
  const key = rateLimitKey(owner, repo)
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const body = await streamToString(res.Body as any)
    const data = JSON.parse(body) as Payload
    const until = data.until ? new Date(data.until).getTime() : 0
    if (until > Date.now()) {
      return { until: data.until, retryAfterMs: data.retryAfterMs ?? 60_000 }
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Store backoff for the given repo (or global) so subsequent /sync requests return degraded.
 */
export async function setRateLimitBackoff(
  owner: string | undefined,
  repo: string | undefined,
  retryAfterMs: number,
  reason?: string
): Promise<void> {
  const key = rateLimitKey(owner, repo)
  const setAt = new Date().toISOString()
  const until = new Date(Date.now() + retryAfterMs).toISOString()
  const payload: Payload = { until, setAt, retryAfterMs, reason: reason ?? "github_rate_limited" }
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}
