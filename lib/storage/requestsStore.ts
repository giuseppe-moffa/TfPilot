import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "requests/"
const HISTORY_PREFIX = "history/"

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

type SaveOptions = {
  expectedVersion?: number
}

async function fetchCurrentVersion(requestId: string) {
  try {
    const current = await getRequest(requestId)
    return typeof current?.version === "number" ? current.version : 0
  } catch {
    return 0
  }
}

async function putRequest(request: any) {
  const key = `${PREFIX}${request.id}.json`
  const body = JSON.stringify(request, null, 2)
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return { key }
}

async function putHistory(request: any) {
  const key = `${HISTORY_PREFIX}${request.id}.json`
  const body = JSON.stringify(request, null, 2)
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return { key }
}

/**
 * Save a request object to S3. When expectedVersion is provided, the current
 * stored version must match or an error is thrown (optimistic locking).
 */
export async function saveRequest(request: any, options: SaveOptions = {}) {
  const nextVersion = typeof request.version === "number" ? request.version : 1

  if (options.expectedVersion !== undefined) {
    const currentVersion = await fetchCurrentVersion(request.id)
    if (currentVersion !== options.expectedVersion) {
      throw new Error("Version conflict while saving request")
    }
  }

  const payload = { ...request, version: nextVersion }
  await putRequest(payload)
  return payload
}

export async function getRequest(requestId: string) {
  const key = `${PREFIX}${requestId}.json`
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const body = await streamToString(res.Body as any)
  return JSON.parse(body)
}

/**
 * Read, mutate, and persist a request with optimistic locking based on the
 * stored version. If the request does not exist, an error is thrown.
 * When mutate returns the same reference as current, no write is performed (idempotent no-op).
 * @returns [request, saved] — saved is false when no write was performed.
 */
export async function updateRequest(
  requestId: string,
  mutate: (request: any) => any
): Promise<[request: any, saved: boolean]> {
  const current = await getRequest(requestId)
  if (!current) {
    throw new Error("Request not found")
  }

  const next = mutate(current)
  if (next === current) {
    return [current, false]
  }

  const currentVersion = typeof current.version === "number" ? current.version : 0
  const nextVersion = (next?.version ?? currentVersion) + 1
  const payload = { ...current, ...next, version: nextVersion }

  await saveRequest(payload, { expectedVersion: currentVersion })
  return [payload, true]
}

export async function archiveRequest(request: any) {
  return await putHistory(request)
}

export async function listRequests(limit = 50) {
  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      MaxKeys: limit,
    })
  )
  const contents = listed.Contents ?? []
  const sorted = contents.sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0)).slice(0, limit)
  const results: any[] = []
  for (const obj of sorted) {
    if (!obj.Key) continue
    const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }))
    const body = await streamToString(data.Body as any)
    results.push(JSON.parse(body))
  }
  return results
}

/** Max requests to scan when resolving by destroy runId (webhook correlation). */
const LIST_LIMIT_FOR_RUN_ID_LOOKUP = 500

/**
 * Find request id that has the given destroy run id (github.workflows.destroy.runId or destroyRun.runId).
 * Used by workflow_run webhook to prefer runId-based correlation for destroy completions.
 */
export async function getRequestIdByDestroyRunId(runId: number): Promise<string | null> {
  const requests = await listRequests(LIST_LIMIT_FOR_RUN_ID_LOOKUP)
  for (const r of requests) {
    const destroyRunId =
      (r as { github?: { workflows?: { destroy?: { runId?: number } } } }).github?.workflows?.destroy?.runId ??
      (r as { destroyRun?: { runId?: number } }).destroyRun?.runId
    if (destroyRunId === runId) return (r as { id: string }).id
  }
  return null
}
