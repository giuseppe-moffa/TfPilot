import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { requestId?: string }
    if (!body?.requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const request = await getRequest(body.requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    if (!request.targetOwner || !request.targetRepo || !request.prNumber) {
      return NextResponse.json({ error: "Missing target repo or PR info" }, { status: 400 })
    }

    const mergeRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}/merge`, {
      method: "PUT",
    })
    const mergeJson = (await mergeRes.json()) as { sha?: string; merged?: boolean }
    if (!mergeJson.merged) {
      return NextResponse.json({ error: "Merge failed" }, { status: 400 })
    }

    await updateRequest(request.id, (current) => ({
      status: "merged",
      mergedSha: mergeJson.sha,
      updatedAt: new Date().toISOString(),
    }))

    return NextResponse.json({ ok: true, mergedSha: mergeJson.sha })
  } catch (error) {
    console.error("[api/github/merge] error", error)
    return NextResponse.json({ error: "Failed to merge PR" }, { status: 500 })
  }
}
