import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubMetricsSnapshot } from "@/lib/observability/github-metrics"

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const snapshot = getGitHubMetricsSnapshot()
  return NextResponse.json(snapshot)
}
