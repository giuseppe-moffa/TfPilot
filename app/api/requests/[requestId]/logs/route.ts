import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  if (!requestId) {
    return NextResponse.json({ success: false, error: "requestId required" }, { status: 400 })
  }

  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const prefix = `logs/${requestId}/`
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: 50,
      })
    )
    const contents = (listed.Contents ?? []).sort(
      (a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0)
    )

    const events = []
    for (const obj of contents) {
      if (!obj.Key) continue
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }))
      const text = await streamToString(res.Body as any)
      try {
        events.push(JSON.parse(text))
      } catch {
        events.push({ raw: text })
      }
    }

    return NextResponse.json({ success: true, events })
  } catch (error) {
    console.error("[api/requests/logs] error", error)
    return NextResponse.json({ success: false, error: "Failed to load logs" }, { status: 500 })
  }
}
