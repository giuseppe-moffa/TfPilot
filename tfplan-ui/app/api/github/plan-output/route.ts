import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

function extractPlan(log: string) {
  const lower = log.toLowerCase()
  const start = lower.indexOf("terraform plan")
  if (start === -1) return null
  // capture until the summary line "Plan: X to add, Y to change, Z to destroy"
  const summaryIdx = lower.indexOf("plan:", start)
  if (summaryIdx === -1) {
    return log.slice(start)
  }
  const endLine = log.indexOf("\n", summaryIdx + 5)
  return endLine === -1 ? log.slice(start) : log.slice(start, endLine + 1)
}

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
    if (!match || !match.planRunId || !match.targetOwner || !match.targetRepo) {
      return NextResponse.json({ error: "Plan run not found" }, { status: 404 })
    }

    const res = await gh(token, `/repos/${match.targetOwner}/${match.targetRepo}/actions/runs/${match.planRunId}/logs`)
    const logText = await res.text()
    const planText = extractPlan(logText)

    const rawLogUrl = `https://github.com/${match.targetOwner}/${match.targetRepo}/actions/runs/${match.planRunId}`

    return NextResponse.json({ planText, rawLogUrl })
  } catch (error) {
    console.error("[api/github/plan-output] error", error)
    return NextResponse.json({ error: "Failed to load plan output" }, { status: 500 })
  }
}
