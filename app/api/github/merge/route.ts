import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"

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

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod merge not allowed for this user" }, { status: 403 })
      }
    }

    // Preflight to surface mergeable state when GitHub rejects merges
    try {
      const prRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}`)
      const prJson = (await prRes.json()) as { mergeable?: boolean; mergeable_state?: string; head?: { sha?: string } }
      if (prJson.mergeable === false || (prJson.mergeable_state && prJson.mergeable_state !== "clean")) {
        const state = prJson.mergeable_state ?? "unknown"
        return NextResponse.json({ error: `PR not mergeable (state=${state})` }, { status: 400 })
      }
    } catch {
      /* ignore preflight failures and attempt merge anyway */
    }

    const mergeRes = await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}/merge`, {
      method: "PUT",
      body: JSON.stringify({ merge_method: "merge" }),
    })
    const mergeJson = (await mergeRes.json()) as { sha?: string; merged?: boolean; message?: string }
    if (!mergeJson.merged) {
      const detail = mergeJson.message || "Merge failed"
      return NextResponse.json({ error: detail }, { status: 400 })
    }

    await updateRequest(request.id, (current) => ({
      status: "merged",
      mergedSha: mergeJson.sha,
      pr: {
        ...(current.pr ?? {}),
        number: current.pr?.number ?? request.prNumber,
        url: current.pr?.url ?? request.prUrl,
        merged: true,
        open: false,
      },
      prNumber: current.prNumber ?? request.prNumber,
      prUrl: current.prUrl ?? request.prUrl,
      updatedAt: new Date().toISOString(),
    }))

    return NextResponse.json({ ok: true, mergedSha: mergeJson.sha })
  } catch (error) {
    console.error("[api/github/merge] error", error)
    return NextResponse.json({ error: "Failed to merge PR" }, { status: 500 })
  }
}
