import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"

export async function GET(req: NextRequest) {
  try {
    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const match = await getRequest(requestId).catch(() => null)
    const prNumber = match?.prNumber ?? match?.pr?.number
    const owner = match?.targetOwner
    const repo = match?.targetRepo
    if (!match || !prNumber || !owner || !repo) {
      return NextResponse.json({ error: "Request or PR not found" }, { status: 404 })
    }

    const res = await gh(token, `/repos/${owner}/${repo}/pulls/${prNumber}/files`)
    const files = (await res.json()) as Array<{
      filename: string
      status: string
      additions: number
      deletions: number
      changes: number
      patch?: string
    }>

    return NextResponse.json({ files })
  } catch (error) {
    console.error("[api/github/pr-diff] error", error)
    return NextResponse.json({ error: "Failed to load PR diff" }, { status: 500 })
  }
}
