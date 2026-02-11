import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

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

    const raw = await readFile(STORAGE_FILE, "utf8").catch(() => "[]")
    const requests = JSON.parse(raw)
    if (!Array.isArray(requests)) {
      return NextResponse.json({ error: "No requests found" }, { status: 404 })
    }
    const match = requests.find((r: any) => r.id === requestId)
    if (!match || !match.applyRunId || !match.targetOwner || !match.targetRepo) {
      return NextResponse.json({ error: "Apply run not found" }, { status: 404 })
    }

    const res = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/actions/runs/${match.applyRunId}/logs`)
    const logText = await res.text()
    const rawLogUrl = `https://github.com/${match.targetOwner}/${match.targetRepo}/actions/runs/${match.applyRunId}`

    return NextResponse.json({ applyText: logText, rawLogUrl })
  } catch (error) {
    console.error("[api/github/apply-output] error", error)
    return NextResponse.json({ error: "Failed to load apply output" }, { status: 500 })
  }
}
