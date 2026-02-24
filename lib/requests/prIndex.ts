/**
 * S3-backed PR → requestId index for correlating pull_request webhook events by PR number.
 * Key: webhooks/github/pr-index/{owner}_{repo}/pr-{prNumber}.json
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/pr-index/"

function safeSegment(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_.-]/g, "_")
}

function prIndexKey(owner: string, repo: string, prNumber: number): string {
  const seg = `${safeSegment(owner)}_${safeSegment(repo)}`
  return `${PREFIX}${seg}/pr-${prNumber}.json`
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
 * Store PR → requestId mapping so pull_request webhooks can correlate by PR number.
 */
export async function putPrIndex(
  owner: string,
  repo: string,
  prNumber: number,
  requestId: string
): Promise<void> {
  const key = prIndexKey(owner, repo, prNumber)
  const body = JSON.stringify({ requestId, owner, repo, prNumber }, null, 2)
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}

/**
 * Look up requestId by owner, repo, and PR number. Returns null if not found.
 */
export async function getRequestIdByPr(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string | null> {
  const key = prIndexKey(owner, repo, prNumber)
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const body = await streamToString(res.Body as any)
    const data = JSON.parse(body) as { requestId?: string }
    return typeof data.requestId === "string" && data.requestId ? data.requestId : null
  } catch {
    return null
  }
}
