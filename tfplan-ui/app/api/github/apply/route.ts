import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

const OWNER = process.env.GITHUB_OWNER ?? "giuseppe-moffa"
const REPO = process.env.GITHUB_REPO ?? "TfPilot"
const APPLY_WORKFLOW = process.env.GITHUB_APPLY_WORKFLOW ?? "apply.yml"

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

    if (request.status !== "merged" && request.status !== "plan_ready") {
      return NextResponse.json({ error: "Request not ready for apply" }, { status: 400 })
    }

    const dispatchBody = {
      ref: "main",
      inputs: {
        request_id: request.id,
        environment: request.environment ?? "dev",
      },
    }

    await gh(
      token,
      `/repos/${OWNER}/${REPO}/actions/workflows/${APPLY_WORKFLOW}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify(dispatchBody),
      }
    )

    requests[idx] = {
      ...request,
      status: "applying",
      applyTriggeredAt: new Date().toISOString(),
    }
    await writeFile(STORAGE_FILE, JSON.stringify(requests, null, 2), "utf8")

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[api/github/apply] error", error)
    return NextResponse.json({ error: "Failed to dispatch apply" }, { status: 500 })
  }
}
