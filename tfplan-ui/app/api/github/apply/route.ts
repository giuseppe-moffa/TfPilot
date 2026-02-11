import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"

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

    let requests: any[] = []
    try {
      const raw = await readFile(STORAGE_FILE, "utf8")
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) requests = parsed
    } catch {
      // ignore
    }

    const idx = requests.findIndex((r) => r.id === body.requestId)
    if (idx === -1) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }
    const request = requests[idx]

    if (request.status !== "merged") {
      return NextResponse.json({ error: "Request must be merged before apply" }, { status: 400 })
    }

    const owner = request.targetOwner
    const repo = request.targetRepo
    const base = request.targetBase ?? "main"
    if (!owner || !repo) {
      return NextResponse.json({ error: "Request missing target repo info" }, { status: 400 })
    }

    const dispatchBody = {
      ref: "main",
      inputs: {
        request_id: request.id,
        environment: request.environment ?? "dev",
      },
    }

    await gh(token, `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify(dispatchBody),
    })

    let applyRunId: number | undefined
    let applyRunUrl: string | undefined
    try {
      const runsRes = await gh(
        token,
        `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
        base
      )}&per_page=1`
      )
      const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
      applyRunId = runsJson.workflow_runs?.[0]?.id
      if (applyRunId) {
        applyRunUrl = `https://github.com/${owner}/${repo}/actions/runs/${applyRunId}`
      }
    } catch {
      /* ignore */
    }

    requests[idx] = {
      ...request,
      status: "applying",
      applyTriggeredAt: new Date().toISOString(),
      applyRunId,
      applyRunUrl,
    }
    await writeFile(STORAGE_FILE, JSON.stringify(requests, null, 2), "utf8")

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[api/github/apply] error", error)
    return NextResponse.json({ error: "Failed to dispatch apply" }, { status: 500 })
  }
}
