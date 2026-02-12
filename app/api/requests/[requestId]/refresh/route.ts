import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { deriveStatus } from "@/lib/requests/status"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"

type Stored = {
  id: string
  project: string
  environment: string
  pr?: { number?: number; url?: string; merged?: boolean; headSha?: string; open?: boolean }
  planRun?: { runId?: number; url?: string; status?: string; conclusion?: string; headSha?: string }
  applyRun?: { runId?: number; url?: string; status?: string; conclusion?: string }
  approval?: { approved?: boolean; approvers?: string[] }
  targetOwner?: string
  targetRepo?: string
  branchName?: string
  status?: string
  reason?: string
  statusDerivedAt?: string
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    const token = await getGitHubAccessToken(req)
    if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })

    const request = (await getRequest(requestId).catch(() => null)) as Stored | null
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })
    if (!request.targetOwner || !request.targetRepo || !request.pr?.number) {
      return NextResponse.json({ error: "Request missing repo or PR" }, { status: 400 })
    }

    const prRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}`)
    const prJson = (await prRes.json()) as { merged?: boolean; head?: { sha?: string }; state?: string; html_url?: string; number?: number }
    request.pr = {
      number: prJson.number ?? request.pr.number,
      url: prJson.html_url ?? request.pr.url,
      merged: prJson.merged,
      headSha: prJson.head?.sha,
      open: prJson.state === "open",
    }

    try {
      const revRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}/reviews`)
      const reviews = (await revRes.json()) as Array<{ user?: { login?: string }; state?: string }>
      const latest = new Map<string, string>()
      for (const r of reviews) {
        const login = r.user?.login
        if (!login) continue
        latest.set(login, r.state ?? "")
      }
      const approvers: string[] = []
      let approved = false
      for (const [login, state] of latest.entries()) {
        if (state === "APPROVED") {
          approvers.push(login)
          approved = true
        }
        if (state === "CHANGES_REQUESTED") {
          approved = false
        }
      }
      request.approval = { approved, approvers }
    } catch {
      /* ignore approvals */
    }

    if (request.planRun?.runId) {
      try {
        const runRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.planRun.runId}`)
        const runJson = (await runRes.json()) as { status?: string; conclusion?: string; head_branch?: string; head_sha?: string; html_url?: string }
        request.planRun = {
          ...request.planRun,
          status: runJson.status ?? request.planRun.status,
          conclusion: runJson.conclusion ?? request.planRun.conclusion,
          headSha: runJson.head_sha ?? request.planRun.headSha,
          url: runJson.html_url ?? request.planRun.url,
        }
      } catch {
        /* ignore */
      }
    }

    if (request.applyRun?.runId) {
      try {
        const runRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.applyRun.runId}`)
        const runJson = (await runRes.json()) as { status?: string; conclusion?: string; html_url?: string }
        request.applyRun = {
          ...request.applyRun,
          status: runJson.status ?? request.applyRun.status,
          conclusion: runJson.conclusion ?? request.applyRun.conclusion,
          url: runJson.html_url ?? request.applyRun.url,
        }
      } catch {
        /* ignore */
      }
    }

    const derived = deriveStatus({
      pr: request.pr,
      planRun: request.planRun,
      applyRun: request.applyRun,
      approval: request.approval,
    })
    request.status = derived.status
    request.reason = derived.reason
    request.statusDerivedAt = new Date().toISOString()

    const now = new Date().toISOString()
    const updated = await updateRequest(requestId, (current) => ({
      ...current,
      pr: request.pr,
      planRun: request.planRun,
      applyRun: request.applyRun,
      approval: request.approval,
      status: derived.status,
      reason: derived.reason,
      statusDerivedAt: now,
      updatedAt: now,
    }))

    return NextResponse.json({ ok: true, request: updated })
  } catch (error) {
    console.error("[api/requests/refresh] error", error)
    return NextResponse.json({ error: "Failed to refresh request" }, { status: 500 })
  }
}
