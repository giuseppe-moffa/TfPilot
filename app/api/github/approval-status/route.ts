import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"

export async function GET(req: NextRequest) {
  try {
    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
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

    const match = await getRequest(requestId).catch(() => null)
    if (!match || !match.prNumber || !match.targetOwner || !match.targetRepo) {
      return NextResponse.json({ error: "Request or PR not found" }, { status: 404 })
    }

    const res = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/pulls/${match.prNumber}/reviews`)
    const reviews = (await res.json()) as Array<{ user?: { login?: string }; state?: string }>

    const latestByUser = new Map<string, string>()
    for (const r of reviews) {
      const login = r.user?.login
      if (!login) continue
      latestByUser.set(login, r.state ?? "")
    }

    const approvers: string[] = []
    let approved = false
    for (const [login, state] of latestByUser.entries()) {
      if (state === "APPROVED") {
        approvers.push(login)
        approved = true
      }
      if (state === "CHANGES_REQUESTED") {
        approved = false
      }
    }

    return NextResponse.json({ approved, approvers })
  } catch (error) {
    console.error("[api/github/approval-status] error", error)
    return NextResponse.json({ error: "Failed to load approval status" }, { status: 500 })
  }
}
