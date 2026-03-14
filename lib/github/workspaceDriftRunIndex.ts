/**
 * S3 index for workspace-scoped drift plan runs: runId -> workspace_id.
 * Used to correlate drift runs (dispatched from workspace detail page) with workspaces
 * for "last drift" display. Facts-only; derivable from GitHub.
 *
 * Pruning: TTL 30 days. On each write, best-effort prune older entries for that workspace.
 * Fail-open: pruning never blocks the main write.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "webhooks/github/workspace-drift/"
const PRUNING_TTL_DAYS = 30

function runKey(runId: number): string {
  return `${PREFIX}run-${runId}.json`
}

function byWorkspaceKey(workspaceId: string): string {
  return `${PREFIX}by-workspace/${workspaceId}.json`
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

type ByWorkspaceEntry = { runId: number; createdAt: string }

export async function putWorkspaceDriftRunIndex(
  runId: number,
  workspaceId: string
): Promise<void> {
  const now = new Date()
  const createdAt = now.toISOString()
  const body = JSON.stringify({ runId, workspace_id: workspaceId, createdAt })
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: runKey(runId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )

  // Update by-workspace index and prune old entries (best-effort)
  try {
    let runs: ByWorkspaceEntry[] = []
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: byWorkspaceKey(workspaceId) })
      )
      const b = await streamToString(res.Body)
      const parsed = JSON.parse(b) as { runs?: ByWorkspaceEntry[] }
      runs = Array.isArray(parsed?.runs) ? parsed.runs : []
    } catch {
      runs = []
    }
    runs.unshift({ runId, createdAt })
    const cutoff = new Date(now.getTime() - PRUNING_TTL_DAYS * 24 * 60 * 60 * 1000)
    const keep = runs.filter((r) => new Date(r.createdAt) >= cutoff)
    const prune = runs.filter((r) => new Date(r.createdAt) < cutoff)

    for (const p of prune) {
      try {
        await s3.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: runKey(p.runId) })
        )
      } catch {
        /* ignore */
      }
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: byWorkspaceKey(workspaceId),
        Body: JSON.stringify({ runs: keep }),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      })
    )
  } catch {
    // Fail-open: main index write already succeeded
  }
}

export async function getWorkspaceIdByDriftRunId(
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

/** TTL in days for drift index pruning. Export for docs/tests. */
export const WORKSPACE_DRIFT_PRUNING_TTL_DAYS = PRUNING_TTL_DAYS
