import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { requestId?: string }
    if (!body?.requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const raw = await readFile(STORAGE_FILE, "utf8").catch(() => "[]")
    const requests = JSON.parse(raw)
    if (!Array.isArray(requests)) {
      return NextResponse.json({ error: "No requests found" }, { status: 404 })
    }
    const idx = requests.findIndex((r: any) => r.id === body.requestId)
    if (idx === -1) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    const request = requests[idx]
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

    requests[idx] = {
      ...request,
      status: "merged",
      mergedSha: mergeJson.sha,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(STORAGE_FILE, JSON.stringify(requests, null, 2), "utf8")

    return NextResponse.json({ ok: true, mergedSha: mergeJson.sha })
  } catch (error) {
    console.error("[api/github/merge] error", error)
    return NextResponse.json({ error: "Failed to merge PR" }, { status: 500 })
  }
}
