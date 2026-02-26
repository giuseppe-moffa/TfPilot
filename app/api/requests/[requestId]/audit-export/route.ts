import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getRequest } from "@/lib/storage/requestsStore"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const HISTORY_PREFIX = "history/"

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

async function fetchLifecycleEvents(requestId: string) {
  const prefix = `logs/${requestId}/`
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: 100,
      })
    )
    const contents = (listed.Contents ?? []).sort(
      (a, b) => (a.LastModified?.getTime() || 0) - (b.LastModified?.getTime() || 0)
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
    return events
  } catch (error) {
    console.error("[api/requests/audit-export] failed to fetch lifecycle events", error)
    return []
  }
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

    // Try to fetch from active requests first, then history
    let request: any = null
    try {
      request = await getRequest(requestId)
    } catch {
      // Try history
      request = await fetchRequestFromHistory(requestId)
    }

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    // Fetch lifecycle events
    const lifecycleEvents = await fetchLifecycleEvents(requestId)

    // Build audit export payload
    const auditExport = {
      request: {
        id: request.id,
        project: request.project,
        environment: request.environment,
        module: request.module,
        targetOwner: request.targetOwner,
        targetRepo: request.targetRepo,
        targetEnvPath: request.targetEnvPath,
        createdAt: request.createdAt || request.receivedAt,
        updatedAt: request.updatedAt,
        status: deriveLifecycleStatus(request),
        revision: request.revision,
      },
      lifecycleEvents,
      workflowRuns: {
        planRun: request.planRun
          ? {
              runId: request.planRun.runId,
              url: request.planRun.url,
              status: request.planRun.status,
              conclusion: request.planRun.conclusion,
              headSha: request.planRun.headSha,
            }
          : null,
        applyRun: request.applyRun
          ? {
              runId: request.applyRun.runId,
              url: request.applyRun.url,
              status: request.applyRun.status,
              conclusion: request.applyRun.conclusion,
            }
          : null,
        destroyRun: request.destroyRun
          ? {
              runId: request.destroyRun.runId,
              url: request.destroyRun.url,
            }
          : null,
      },
      exportedAt: new Date().toISOString(),
    }

    const jsonContent = JSON.stringify(auditExport, null, 2)

    return new NextResponse(jsonContent, {
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
