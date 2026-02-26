/**
 * O(1) S3 index for resolving GitHub workflow runId → TfPilot requestId.
 * Key: webhooks/github/run-index/<kind>/run-<runId>.json
 * Value: { kind, runId, requestId, createdAt, expiresAt }
 * Intended retention: 90 days. expiresAt is metadata only until S3 lifecycle rule.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"
import type { WorkflowKind } from "@/lib/github/workflowClassification"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const INDEX_PREFIX = "webhooks/github/run-index/"

function indexKey(kind: WorkflowKind, runId: number): string {
  return `${INDEX_PREFIX}${kind}/run-${runId}.json`
}

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

/** 90-day TTL for index entries; S3 lifecycle can use this as guidance. */
export const RUN_INDEX_RETENTION_DAYS = 90

export type RunIndexEntry = {
  kind: WorkflowKind
  runId: number
  requestId: string
  createdAt: string
  /** ISO string: createdAt + 90 days. Metadata only until S3 lifecycle rule. */
  expiresAt: string
}

/**
 * Write run → requestId index entry for any workflow kind (non-blocking; call .catch(() => {}) at call site if needed).
 */
export async function putRunIndex(
  kind: WorkflowKind,
  runId: number,
  requestId: string
): Promise<void> {
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(
    now.getTime() + RUN_INDEX_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
  const body = JSON.stringify(
    { kind, runId, requestId, createdAt, expiresAt } satisfies RunIndexEntry
  )
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: indexKey(kind, runId),
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}

/**
 * O(1) lookup: get requestId for a run of the given kind from the S3 index.
 * Returns null if the object does not exist or is invalid.
 */
export async function getRequestIdByRunId(
  kind: WorkflowKind,
  runId: number
): Promise<string | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: indexKey(kind, runId),
      })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body) as { kind?: string; runId?: number; requestId?: string }
    if (
      typeof parsed?.requestId === "string" &&
      parsed.runId === runId &&
      parsed.kind === kind
    ) {
      return parsed.requestId
    }
    return null
  } catch {
    return null
  }
}

// --- Destroy backwards compatibility ---

/** @deprecated Use putRunIndex("destroy", runId, requestId) */
export async function putDestroyRunIndex(runId: number, requestId: string): Promise<void> {
  return putRunIndex("destroy", runId, requestId)
}

/** @deprecated Use getRequestIdByRunId("destroy", runId) */
export async function getRequestIdByDestroyRunIdIndexed(runId: number): Promise<string | null> {
  return getRequestIdByRunId("destroy", runId)
}

/** Kept for type compatibility. */
export type DestroyRunIndexEntry = RunIndexEntry & { kind: "destroy" }
