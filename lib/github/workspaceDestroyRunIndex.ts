/**
 * S3 index for workspace destroy runs: runId <-> workspace_id.
 * - run-<runId>.json: { runId, workspace_id } — webhook correlates destroy completion to workspace
 * - pending-<workspaceId>.json: { run_id, repo, created_at } — check if workspace destroy in progress
 *
 * FACTS-ONLY ETHOS: These indexes are correlation caches, never authoritative. They are
 * derivable (from GitHub run status + inputs) and repairable (index miss → fetch run, derive,
 * or manual archive). Authoritative state: Postgres archived_at, GitHub run status.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/workspace-destroy/"

function runKey(runId: number): string {
  return `${PREFIX}run-${runId}.json`
}

function pendingKey(workspaceId: string): string {
  return `${PREFIX}pending-${workspaceId}.json`
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

export async function putWorkspaceDestroyRunIndex(
  runId: number,
  workspaceId: string
): Promise<void> {
  const body = JSON.stringify({ runId, workspace_id: workspaceId })
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

export async function getWorkspaceIdByDestroyRunId(
  runId: number
): Promise<string | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: runKey(runId) })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body) as { runId?: number; workspace_id?: string }
    if (parsed?.workspace_id && parsed.runId === runId) {
      return parsed.workspace_id
    }
    return null
  } catch {
    return null
  }
}

export type WorkspaceDestroyPending = {
  run_id: number
  repo: string
  created_at: string
}

const PENDING_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

export function isPendingStaleByTTL(pending: WorkspaceDestroyPending): boolean {
  const created = Date.parse(pending.created_at)
  return !Number.isNaN(created) && Date.now() - created > PENDING_TTL_MS
}

export async function putWorkspaceDestroyPending(
  workspaceId: string,
  runId: number,
  repo: string
): Promise<void> {
  const created_at = new Date().toISOString()
  const body = JSON.stringify({ run_id: runId, repo, created_at })
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: pendingKey(workspaceId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}

export async function getWorkspaceDestroyPending(
  workspaceId: string
): Promise<WorkspaceDestroyPending | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: pendingKey(workspaceId) })
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

export async function deleteWorkspaceDestroyPending(
  workspaceId: string
): Promise<void> {
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: pendingKey(workspaceId) })
    )
  } catch {
    // Ignore; object may not exist
  }
}
