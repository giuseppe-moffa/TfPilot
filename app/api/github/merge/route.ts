import { NextRequest, NextResponse } from "next/server"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { runUpdateBranch } from "@/lib/github/updateBranch"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"

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
    const role = getUserRole(session.login)
    if (role !== "approver" && role !== "admin") {
      return NextResponse.json({ error: "Merge not permitted for your role" }, { status: 403 })
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

    // Do not run update-branch in preflight — only run when merge fails with "out of date" (see below)
    // to avoid creating two commits (preflight + retry path).

    const owner = request.targetOwner!
    const repo = request.targetRepo!
    const prNum = request.prNumber!
    const tokenStr = token
    async function attemptMerge(): Promise<Response> {
      return gh(
        tokenStr,
        `/repos/${owner}/${repo}/pulls/${prNum}/merge`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merge_method: "merge" }),
        }
      )
    }

    /** Merge failed due to conflicts or branch behind base — run update-branch so we can resolve and retry. */
    function shouldRunUpdateBranch(detail: string): boolean {
      const lower = detail.toLowerCase()
      return (
        lower.includes("not mergeable") ||
        lower.includes("out of date") ||
        lower.includes("update it with the latest") ||
        lower.includes("update the branch") ||
        lower.includes("conflict") ||
        lower.includes("conflicting")
      )
    }

    let mergeRes: Response
    let mergeErrDetail: string | null = null
    try {
      mergeRes = await attemptMerge()
    } catch (mergeErr: unknown) {
      const msg = mergeErr instanceof Error ? mergeErr.message : ""
      let detail = "Merge failed"
      const bodyMatch = typeof msg === "string" && msg.includes(": ") ? msg.split(": ").slice(1).join(": ") : ""
      try {
        const parsed = bodyMatch ? (JSON.parse(bodyMatch) as { message?: string }) : null
        if (parsed?.message) detail = parsed.message
      } catch {
        if (bodyMatch && bodyMatch.length < 200) detail = bodyMatch
      }
      mergeErrDetail = detail
    }

    // If merge failed (conflicts / not mergeable / out of date), run update-branch to resolve, then retry once
    if (mergeErrDetail && shouldRunUpdateBranch(mergeErrDetail)) {
      console.log("[TfPilot merge] Merge failed, running update-branch. Detail:", mergeErrDetail)
      let prBranchName = request.branchName
      if (!prBranchName) {
        try {
          const prRes = await gh(tokenStr, `/repos/${owner}/${repo}/pulls/${prNum}`)
          const prData = (await prRes.json()) as { head?: { ref?: string } }
          prBranchName = prData.head?.ref ?? null
        } catch {
          prBranchName = null
        }
      }
      if (prBranchName) {
        const updateResult = await runUpdateBranch(token, {
          targetOwner: request.targetOwner!,
          targetRepo: request.targetRepo!,
          branchName: prBranchName,
          prNumber: request.prNumber ?? undefined,
        })
        if (!updateResult.ok) {
          console.log("[TfPilot merge] Update-branch failed:", updateResult.error)
          return NextResponse.json(
            { error: updateResult.error || mergeErrDetail },
            { status: updateResult.status ?? 400 }
          )
        }
        console.log("[TfPilot merge] Update-branch ok, sha:", updateResult.sha, "resolvedConflicts:", updateResult.resolvedConflicts)
        // Give GitHub time to recompute mergeability after the new commit (often 5–10s)
        await new Promise((r) => setTimeout(r, 7000))
        mergeErrDetail = null
        try {
          mergeRes = await attemptMerge()
        } catch (_retryErr: unknown) {
          // One more short wait and retry before asking user to click Merge again
          console.log("[TfPilot merge] First retry failed, waiting 4s then retrying merge once more…")
          await new Promise((r) => setTimeout(r, 4000))
          try {
            mergeRes = await attemptMerge()
          } catch (secondRetryErr: unknown) {
            const msg = secondRetryErr instanceof Error ? secondRetryErr.message : ""
            let detail = "Merge failed"
            const bodyMatch = typeof msg === "string" && msg.includes(": ") ? msg.split(": ").slice(1).join(": ") : ""
            try {
              const parsed = bodyMatch ? (JSON.parse(bodyMatch) as { message?: string }) : null
              if (parsed?.message) detail = parsed.message
            } catch {
              if (bodyMatch && bodyMatch.length < 200) detail = bodyMatch
            }
            console.log("[TfPilot merge] Retry merge still failed after update-branch; returning branchUpdated so user can try Merge again.")
            return NextResponse.json({
              ok: true,
              branchUpdated: true,
              sha: updateResult.sha,
              ...(updateResult.resolvedConflicts && { resolvedConflicts: true }),
              message:
                "Branch has been updated. If it still shows as conflicted, click Merge or Update branch again to re-run conflict resolution, then merge.",
            })
          }
          // Second retry succeeded — fall through to handle mergeRes below
        }
      }
    }

    if (mergeErrDetail) {
      return NextResponse.json(
        { error: mergeErrDetail },
        { status: 400 }
      )
    }

    const mergeJson = (await mergeRes!.json()) as { sha?: string; merged?: boolean; message?: string }
    if (!mergeJson.merged) {
      const detail = mergeJson.message || "Merge failed"
      return NextResponse.json({ error: detail }, { status: 400 })
    }

    await updateRequest(request.id, (current) => ({
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

    await logLifecycleEvent({
      requestId: request.id,
      event: "pr_merged",
      actor: session.login,
      source: "api/github/merge",
      data: {
        prNumber: request.prNumber,
        mergedSha: mergeJson.sha,
        targetRepo: `${request.targetOwner}/${request.targetRepo}`,
      },
    })

    return NextResponse.json({ ok: true, mergedSha: mergeJson.sha })
  } catch (error) {
    console.error("[api/github/merge] error", error)
    const message = error instanceof Error ? error.message : ""
    let userMessage = "Failed to merge PR"
    if (message.includes("GitHub API error") && message.includes(": ")) {
      const body = message.split(": ").slice(1).join(": ").trim()
      try {
        const parsed = body ? (JSON.parse(body) as { message?: string }) : null
        if (parsed?.message) userMessage = parsed.message
      } catch {
        if (body && body.length < 300) userMessage = body
      }
    }
    const status = (error as { status?: number })?.status
    return NextResponse.json(
      { error: userMessage },
      { status: status && status >= 400 && status < 600 ? status : 500 }
    )
  }
}
