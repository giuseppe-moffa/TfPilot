import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/session"
import { withCorrelation } from "@/lib/observability/correlation"
import { timeAsync } from "@/lib/observability/logger"
import { getRequest } from "@/lib/storage/requestsStore"
import { ensureAssistantState } from "@/lib/assistant/state"
import { getRequestCost } from "@/lib/services/cost-service"

export async function GET(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const correlation = withCorrelation(req, {})
  const sessionOr401 = await requireSession(undefined, correlation)
  if (sessionOr401 instanceof NextResponse) return sessionOr401
  const session = sessionOr401

  const { requestId } = await params
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 })
  }

  try {
    return await timeAsync(
      "request.read",
      { ...correlation, requestId, user: session.login },
      async () => {
        try {
          const request = ensureAssistantState(await getRequest(requestId))
          if (!request) {
            return NextResponse.json({ error: "Not found" }, { status: 404 })
          }
          const cost = await getRequestCost(requestId)
          if (cost) request.cost = cost
          return NextResponse.json({ request })
        } catch (err: unknown) {
          if (err && typeof err === "object" && ("$metadata" in err || "name" in err)) {
            const e = err as { $metadata?: { httpStatusCode?: number }; name?: string }
            if (e.$metadata?.httpStatusCode === 404 || e.name === "NoSuchKey") {
              return NextResponse.json({ error: "Not found" }, { status: 404 })
            }
          }
          throw err
        }
      }
    )
  } catch {
    return NextResponse.json({ error: "Failed to load request" }, { status: 500 })
  }
}
