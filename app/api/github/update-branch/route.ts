import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { requireRequestProjectPermission } from "@/lib/auth/requestProjectPermission"
import { getRequestOrgId } from "@/lib/db/requestsList"
import { runUpdateBranch } from "@/lib/github/updateBranch"

/**
 * Back-merge the repo's base branch (e.g. main) into the request's PR branch.
 * Use when PR is not mergeable (state=dirty) because the base branch moved forward.
 * On 409 merge conflict, resolves by "accept all" and pushes a new commit.
 * POST body: { requestId: string }
 */
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
    const permRes = await requireRequestProjectPermission(
      { login: session.login, orgId: session.orgId ?? null },
      request as { project_key?: string; org_id?: string },
      body.requestId,
      "approve",
      { getRequestOrgId }
    )
    if (permRes) return permRes
    if (!request.targetOwner || !request.targetRepo) {
      return NextResponse.json({ error: "Missing target repo" }, { status: 400 })
    }

    const prBranch = request.branchName
    if (!prBranch) {
      return NextResponse.json({ error: "Request has no branch name" }, { status: 400 })
    }

    const result = await runUpdateBranch(token, {
      targetOwner: request.targetOwner,
      targetRepo: request.targetRepo,
      branchName: prBranch,
      prNumber: request.prNumber ?? undefined,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.status && { code: result.status === 409 ? "merge_conflict" : undefined }) },
        { status: result.status ?? 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      ...(result.alreadyUpToDate && { alreadyUpToDate: true }),
      ...(result.sha && { sha: result.sha }),
      ...(result.resolvedConflicts && { resolvedConflicts: true }),
    })
  } catch (error) {
    console.error("[api/github/update-branch] error", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update branch" },
      { status: 500 }
    )
  }
}
