import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { buildAuditEvents } from "@/lib/requests/auditEvents"
import { getRequest } from "@/lib/storage/requestsStore"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const HISTORY_PREFIX = "history/"

async function streamToString(stream: unknown): Promise<string> {
  if (!stream || typeof (stream as NodeJS.ReadableStream).on !== "function") return ""
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    ;(stream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => chunks.push(chunk))
    ;(stream as NodeJS.ReadableStream).on("error", reject)
    ;(stream as NodeJS.ReadableStream).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

async function fetchRequestFromHistory(requestId: string) {
  const key = `${HISTORY_PREFIX}${requestId}.json`
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const body = await streamToString(res.Body as any)
    return JSON.parse(body)
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    let request: any = null
    try {
      request = await getRequest(requestId)
    } catch {
      request = await fetchRequestFromHistory(requestId)
    }

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const generatedAt = new Date().toISOString()
    const events = buildAuditEvents(request, generatedAt)

    const payload = { requestId, generatedAt, events }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="audit-${requestId}.json"`,
      },
    })
  } catch (error) {
    console.error("[api/requests/audit-export] error", error)
    return NextResponse.json({ error: "Failed to export audit log" }, { status: 500 })
  }
}
