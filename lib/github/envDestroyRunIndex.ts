/**
 * S3 index for environment destroy runs: runId <-> environment_id.
 * - run-<runId>.json: { runId, environment_id } — webhook correlates destroy completion to env
 * - pending-<environment_id>.json: { runId, dispatchedAt } — check if env destroy in progress
 *
 * FACTS-ONLY ETHOS: These indexes are correlation caches, never authoritative. They are
 * derivable (from GitHub run status + inputs) and repairable (index miss → fetch run, derive,
 * or manual archive). Authoritative state: Postgres archived_at, GitHub run status.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/env-destroy/"

function runKey(runId: number): string {
  return `${PREFIX}run-${runId}.json`
}

function pendingKey(environmentId: string): string {
  return `${PREFIX}pending-${environmentId}.json`
}

async function streamToString(stream: unknown): Promise<string> {
  if (!stream || typeof (stream as any).on !== "function") {
    return ""
  }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    ;(stream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => chunks.push(chunk))
    ;(stream as NodeJS.ReadableStream).on("error", reject)
    ;(stream as NodeJS.ReadableStream).on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    )
  })
}

export async function putEnvDestroyRunIndex(
  runId: number,
  environmentId: string
): Promise<void> {
  const body = JSON.stringify({ runId, environment_id: environmentId })
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: runKey(runId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}

export async function getEnvironmentIdByEnvDestroyRunId(
  runId: number
): Promise<string | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: runKey(runId) })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body) as { runId?: number; environment_id?: string }
    if (parsed?.environment_id && parsed.runId === runId) {
      return parsed.environment_id
    }
    return null
  } catch {
    return null
  }
}

export type EnvDestroyPending = {
  run_id: number
  repo: string
  created_at: string
}

const PENDING_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

export function isPendingStaleByTTL(pending: EnvDestroyPending): boolean {
  const created = Date.parse(pending.created_at)
  return !Number.isNaN(created) && Date.now() - created > PENDING_TTL_MS
}

export async function putEnvDestroyPending(
  environmentId: string,
  runId: number,
  repo: string
): Promise<void> {
  const created_at = new Date().toISOString()
  const body = JSON.stringify({ run_id: runId, repo, created_at })
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: pendingKey(environmentId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}

export async function getEnvDestroyPending(
  environmentId: string
): Promise<EnvDestroyPending | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: pendingKey(environmentId) })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body) as {
      run_id?: number
      runId?: number
      repo?: string
      created_at?: string
      dispatchedAt?: string
    }
    const run_id = parsed?.run_id ?? parsed?.runId
    const created_at = parsed?.created_at ?? parsed?.dispatchedAt
    if (run_id != null && created_at) {
      return {
        run_id,
        repo: parsed?.repo ?? "",
        created_at,
      }
    }
    return null
  } catch {
    return null
  }
}

export async function deleteEnvDestroyPending(
  environmentId: string
): Promise<void> {
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: pendingKey(environmentId) })
    )
  } catch {
    // Ignore; object may not exist
  }
}
