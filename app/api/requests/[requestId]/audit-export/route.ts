import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { fetchLifecycleEvents } from "@/lib/logs/lifecycle"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getCurrentAttemptStrict, type AttemptRecord, type RunsState } from "@/lib/requests/runsModel"
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

    // Fetch lifecycle events and sort ascending by timestamp
    const lifecycleEventsRaw = await fetchLifecycleEvents(requestId)
    const lifecycleEvents = [...lifecycleEventsRaw].sort(
      (a, b) =>
        new Date((a as { timestamp?: string }).timestamp ?? 0).getTime() -
        new Date((b as { timestamp?: string }).timestamp ?? 0).getTime()
    )

    const runs = request.runs as RunsState | undefined

    /** Serialize attempt for export (only include optional fields when present). */
    function toAttemptExport(a: AttemptRecord) {
      const out: Record<string, unknown> = {
        attempt: a.attempt,
        runId: a.runId,
        url: a.url,
        status: a.status,
        conclusion: a.conclusion ?? undefined,
        dispatchedAt: a.dispatchedAt,
        completedAt: a.completedAt,
      }
      if (a.headSha != null) out.headSha = a.headSha
      if (a.actor != null) out.actor = a.actor
      return out
    }

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
      workflowRuns: (() => {
        const planAttempt = getCurrentAttemptStrict(runs, "plan")
        const applyAttempt = getCurrentAttemptStrict(runs, "apply")
        const destroyAttempt = getCurrentAttemptStrict(runs, "destroy")
        return {
          plan: planAttempt
            ? {
                runId: planAttempt.runId,
                url: planAttempt.url,
                status: planAttempt.status,
                conclusion: planAttempt.conclusion,
                headSha: planAttempt.headSha,
              }
            : null,
          apply: applyAttempt
            ? {
                runId: applyAttempt.runId,
                url: applyAttempt.url,
                status: applyAttempt.status,
                conclusion: applyAttempt.conclusion,
              }
            : null,
          destroy: destroyAttempt
            ? {
                runId: destroyAttempt.runId,
                url: destroyAttempt.url,
              }
            : null,
        }
      })(),
      workflowAttempts: {
        plan: (runs?.plan?.attempts ?? []).map(toAttemptExport),
        apply: (runs?.apply?.attempts ?? []).map(toAttemptExport),
        destroy: (runs?.destroy?.attempts ?? []).map(toAttemptExport),
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
