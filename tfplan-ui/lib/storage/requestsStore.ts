import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const PREFIX = "requests/"

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

export async function saveRequest(request: any) {
  const key = `${PREFIX}${request.id}.json`
  const body = JSON.stringify(request, null, 2)
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "application/json" }))
  return { key }
}

export async function getRequest(requestId: string) {
  const key = `${PREFIX}${requestId}.json`
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const body = await streamToString(res.Body as any)
  return JSON.parse(body)
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
