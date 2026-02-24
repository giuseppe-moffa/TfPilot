import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { getStreamState } from "@/lib/github/streamState"

const POLL_MS = 2_000
const HEARTBEAT_MS = 15_000

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

export async function GET(req: NextRequest) {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401

  const sinceParam = req.nextUrl.searchParams.get("since")
  let since = typeof sinceParam === "string" ? parseInt(sinceParam, 10) : 0
  if (!Number.isFinite(since)) since = 0

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let lastHeartbeat = Date.now()

      const tick = async () => {
        if (req.signal?.aborted) {
          controller.close()
          return
        }
        const now = Date.now()
        if (now - lastHeartbeat >= HEARTBEAT_MS) {
          try {
            controller.enqueue(encoder.encode(":heartbeat\n\n"))
          } catch {
            controller.close()
            return
          }
          lastHeartbeat = now
        }

        try {
          const state = await getStreamState()
          for (const ev of state.events) {
            if (ev.seq > since) {
              try {
                controller.enqueue(
                  encoder.encode(formatSSE("request", JSON.stringify(ev)))
                )
              } catch {
                controller.close()
                return
              }
              since = ev.seq
            }
          }
        } catch {
          // ignore getStreamState errors, keep streaming
        }
      }

      await tick()
      const interval = setInterval(async () => {
        if (req.signal?.aborted) {
          clearInterval(interval)
          controller.close()
          return
        }
        await tick()
      }, POLL_MS)

      req.signal?.addEventListener?.("abort", () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
