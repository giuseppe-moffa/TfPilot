import { NextRequest, NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
async function ghWithRetry(token: string, url: string, attempts = 3, delayMs = 300) {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await gh(token, url)
      if (!res.ok && res.status >= 500) {
        throw new Error(`GH ${res.status}`)
      }
      return res
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
      }
    }
  }
  throw lastErr
}

import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getRequestCost } from "@/lib/services/cost-service"
import { env } from "@/lib/config/env"
import { ensureAssistantState } from "@/lib/assistant/state"
import { sendAdminNotification, formatRequestNotification } from "@/lib/notifications/email"
import { stripPlanOutputToContent } from "@/lib/plan/strip-plan-output"

function extractPlan(log: string) {
  const lower = log.toLowerCase()
  const planIdx = lower.indexOf("terraform plan")
  if (planIdx !== -1) {
    const summaryIdx = lower.lastIndexOf("plan:", lower.length)
    if (summaryIdx !== -1 && summaryIdx > planIdx) {
      const endLine = log.indexOf("\n", summaryIdx + 5)
      return log.slice(planIdx, endLine === -1 ? undefined : endLine + 1)
    }
    return log.slice(planIdx)
  }
  const lines = log.trim().split("\n")
  return lines.slice(-120).join("\n")
}

async function fetchJobLogs(token: string, owner: string, repo: string, runId: number): Promise<string | null> {
  try {
    const jobsRes = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
    const jobsJson = (await jobsRes.json()) as { jobs?: Array<{ id: number }> }
    const jobId = jobsJson.jobs?.[0]?.id
    if (!jobId) return null
    const logsRes = await gh(token, `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`)
    return await logsRes.text()
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const sessionOr401 = await requireSession()
    if (sessionOr401 instanceof NextResponse) return sessionOr401
    const { requestId } = await params
    const token = await getGitHubAccessToken(req)
    if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })

    const request = ensureAssistantState(await getRequest(requestId).catch(() => null))
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })

    // Store previous state for email deduplication
    const previousPlanConclusion = request.planRun?.conclusion
    const previousApplyConclusion = request.applyRun?.conclusion
    const previousDestroyConclusion = request.destroyRun?.conclusion

    if (!request.targetOwner || !request.targetRepo) {
      return NextResponse.json({ error: "Request missing repo info" }, { status: 400 })
    }

    // hydrate PR struct if only prNumber/prUrl were stored
    if (!request.pr && request.prNumber) {
      request.pr = { number: request.prNumber, url: request.prUrl }
    }

    if (request.pr?.number) {
      const prRes = await ghWithRetry(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}`)
      const prJson = (await prRes.json()) as {
        merged?: boolean
        head?: { sha?: string }
        state?: string
        html_url?: string
        number?: number
        title?: string
        merge_commit_sha?: string | null
      }
      request.pr = {
        number: prJson.number ?? request.pr.number,
        url: prJson.html_url ?? request.pr.url,
        status: prJson.state ?? request.pr.status,
        merged: prJson.merged,
        headSha: prJson.head?.sha,
        open: prJson.state === "open",
      }
      if (prJson.merged && prJson.merge_commit_sha && !request.mergedSha) {
        request.mergedSha = prJson.merge_commit_sha
      }
      // keep legacy top-level fields in sync for UI links
      request.prNumber = request.pr.number
      request.prUrl = request.pr.url
      request.pullRequest = {
        number: request.pr.number,
        url: request.pr.url,
        title: prJson.title ?? request.pullRequest?.title,
        merged: request.pr.merged,
        headSha: request.pr.headSha,
        open: request.pr.open,
        status: prJson.state ?? request.pullRequest?.status,
      }

      try {
        const revRes = await ghWithRetry(token, `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}/reviews`)
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
    }

    // Discover cleanup PR (branch cleanup/{requestId})
    if (request.targetOwner && request.targetRepo) {
      try {
        const cleanupHead = `${request.targetOwner}:cleanup/${request.id}`
        const cleanupRes = await gh(
          token,
          `/repos/${request.targetOwner}/${request.targetRepo}/pulls?head=${encodeURIComponent(
            cleanupHead
          )}&state=all&per_page=1`
        )
        const cleanupJson = (await cleanupRes.json()) as Array<{
          number?: number
          html_url?: string
          state?: string
          merged_at?: string | null
          merged?: boolean
          head?: { ref?: string }
        }>
        const cleanupPr = cleanupJson?.[0]
        if (cleanupPr?.number) {
          const merged = Boolean(cleanupPr.merged)
          const state = cleanupPr.state ?? (merged ? "closed" : "open")
          request.cleanupPr = {
            number: cleanupPr.number,
            url: cleanupPr.html_url,
            status: state,
            merged,
            headBranch: cleanupPr.head?.ref,
          }
        }
      } catch {
        /* ignore cleanup PR discovery */
      }
    }

    // If we never captured a plan run ID (GitHub dispatch lag), try to discover it by branch/workflow
    if (!request.planRun?.runId && request.branchName && env.GITHUB_PLAN_WORKFLOW_FILE) {
      try {
        const runsRes = await ghWithRetry(
          token,
          `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
            request.branchName
          )}&per_page=3`
        )
        const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }> }
        const firstRun = runsJson.workflow_runs?.[0]
        if (firstRun?.id) {
          request.planRun = {
            runId: firstRun.id,
            status: firstRun.status,
            conclusion: firstRun.conclusion,
            headSha: firstRun.head_sha,
            url: firstRun.html_url,
          }
        }
      } catch {
        /* ignore discovery failures */
      }
    }

    // Remember whether we had an apply run before discovery (so we don't keep a freshly-discovered run that doesn't belong to this request)
    const hadApplyRunBeforeSync = !!request.applyRun?.runId

    // Discover apply run if missing (try request branch first, then base branch)
    if (!request.applyRun?.runId && env.GITHUB_APPLY_WORKFLOW_FILE) {
      try {
        const candidates = [
          request.branchName,
          request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH ?? "main",
        ].filter(Boolean) as string[]
        for (const branch of candidates) {
          const runsRes = await ghWithRetry(
            token,
            `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
              branch
            )}&per_page=5`
          )
          const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }> }
          const firstRun =
            runsJson.workflow_runs?.find(
              (r) =>
                r.head_sha === request.applyRun?.headSha ||
                r.head_sha === request.mergedSha ||
                r.head_sha === request.commitSha ||
                r.head_sha === request.planRun?.headSha
            ) ?? runsJson.workflow_runs?.[0]
          if (firstRun?.id) {
            request.applyRun = {
              runId: firstRun.id,
              status: firstRun.status,
              conclusion: firstRun.conclusion,
              headSha: firstRun.head_sha,
              url: firstRun.html_url,
            }
            break
          }
        }
      } catch {
        /* ignore discovery failures */
      }
    }

    // Validate applyRun head_sha matches this request; if not, discard to avoid cross-request contamination.
    // Only keep a non-matching applyRun when we already had it before this sync (so we don't attach another request's successful run to a new request).
    const applyHeadSha = request.applyRun?.headSha
    const candidateShas = new Set(
      [request.mergedSha, request.commitSha, request.planRun?.headSha, request.pr?.headSha].filter(Boolean) as string[]
    )
    const applyMatches = applyHeadSha ? candidateShas.has(applyHeadSha) : false
    const keepApplyRunAnyway =
      hadApplyRunBeforeSync && request.applyRun?.conclusion === "success"
    if (request.applyRun && !applyMatches && !keepApplyRunAnyway) {
      request.applyRun = undefined
      request.applyRunId = undefined
      request.applyRunUrl = undefined
    }

    if (request.planRun?.runId) {
      try {
        const runRes = await ghWithRetry(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.planRun.runId}`)
        const runJson = (await runRes.json()) as { status?: string; conclusion?: string; head_sha?: string; html_url?: string }
        request.planRun = {
          ...request.planRun,
          status: runJson.status ?? request.planRun.status,
          conclusion: runJson.conclusion ?? request.planRun.conclusion,
          headSha: runJson.head_sha ?? request.planRun.headSha,
          url: runJson.html_url ?? request.planRun.url,
        }

        const logs = await fetchJobLogs(token, request.targetOwner, request.targetRepo, request.planRun.runId)
        if (logs) {
          const raw = extractPlan(logs)
          const planText = raw != null ? stripPlanOutputToContent(raw) : request.plan?.output
          request.plan = {
            ...(request.plan ?? {}),
            output: planText ?? request.plan?.output,
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (request.applyRun?.runId) {
      try {
        const runRes = await ghWithRetry(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.applyRun.runId}`)
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

    if (request.destroyRun?.runId) {
      try {
        const runRes = await ghWithRetry(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.destroyRun.runId}`)
        const runJson = (await runRes.json()) as {
          status?: string
          conclusion?: string
          html_url?: string
        }
        request.destroyRun = {
          ...request.destroyRun,
          status: runJson.status ?? request.destroyRun.status,
          conclusion: runJson.conclusion ?? request.destroyRun.conclusion,
          url: runJson.html_url ?? request.destroyRun.url,
        }
      } catch {
        /* ignore */
      }
    }

    const status = deriveLifecycleStatus(request)
    request.status = status
    const nowIso = new Date().toISOString()
    request.statusDerivedAt = nowIso
    request.updatedAt = nowIso

    // Email notifications on lifecycle transitions (deduplicated by checking previous state)
    // Apply success/failure
    if (request.applyRun?.conclusion && request.applyRun.conclusion !== previousApplyConclusion) {
      const actor = request.applyRun.conclusion === "success" ? (request.approval?.approvers?.[0] || "system") : "system"
      if (request.applyRun.conclusion === "success") {
        const { subject, body } = formatRequestNotification("apply_success", request, actor, request.applyRun.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send apply_success email", err)
        )
      } else if (request.applyRun.conclusion === "failure") {
        const { subject, body } = formatRequestNotification("apply_failed", request, actor, request.applyRun.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send apply_failed email", err)
        )
      }
    }

    // Destroy success/failure
    if (request.destroyRun?.conclusion && request.destroyRun.conclusion !== previousDestroyConclusion) {
      const actor = "system" // Destroy actor is typically from destroy endpoint, but we don't have it here
      if (request.destroyRun.conclusion === "success") {
        const { subject, body } = formatRequestNotification("destroy_success", request, actor, request.destroyRun.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send destroy_success email", err)
        )
      } else if (request.destroyRun.conclusion === "failure") {
        const { subject, body } = formatRequestNotification("destroy_failed", request, actor, request.destroyRun.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send destroy_failed email", err)
        )
      }
    }

    // Plan failure
    if (request.planRun?.conclusion === "failure" && request.planRun.conclusion !== previousPlanConclusion) {
      const actor = "system"
      const { subject, body } = formatRequestNotification("plan_failed", request, actor, request.planRun.url)
      await sendAdminNotification(subject, body).catch((err) =>
        console.error("[api/requests/sync] failed to send plan_failed email", err)
      )
    }

    // Timeline updates for cleanup PR
    const timeline = Array.isArray(request.timeline) ? request.timeline : []
    const hasCleanupOpened = timeline.some((t: any) => t.step === "Cleanup PR opened")
    const hasCleanupMerged = timeline.some((t: any) => t.step === "Cleanup PR merged")
    if (request.cleanupPr?.number && !hasCleanupOpened) {
      timeline.push({
        step: "Cleanup PR opened",
        status: request.cleanupPr.status === "open" ? "In Progress" : "Complete",
        message: request.cleanupPr.url ?? "Cleanup PR created",
        at: new Date().toISOString(),
      })
    }
    if (request.cleanupPr?.merged && !hasCleanupMerged) {
      timeline.push({
        step: "Cleanup PR merged",
        status: "Complete",
        message: request.cleanupPr.url ?? "Cleanup PR merged",
        at: new Date().toISOString(),
      })
    }
    request.timeline = timeline

    const updated = await updateRequest(requestId, (current) => ({
      ...current,
      pr: request.pr,
      prNumber: request.prNumber ?? current.prNumber,
      prUrl: request.prUrl ?? current.prUrl,
      pullRequest: request.pullRequest ?? current.pullRequest,
      planRun: request.planRun,
      applyRun: request.applyRun,
      approval: request.approval,
      cleanupPr: request.cleanupPr,
      status: request.status,
      statusDerivedAt: request.statusDerivedAt,
      updatedAt: request.updatedAt,
      timeline: request.timeline,
      plan: request.plan,
      destroyRun: request.destroyRun,
    }))

    const cost = await getRequestCost(requestId)
    if (cost) {
      ;(updated as any).cost = cost
    }

    return NextResponse.json({ ok: true, request: updated })
  } catch (error) {
    console.error("[api/requests/sync] error", error)
    const status = (error as { status?: number })?.status
    const isRateLimit =
      status === 403 &&
      (error instanceof Error && error.message.toLowerCase().includes("rate limit"))
    if (isRateLimit) {
      return NextResponse.json(
        { error: "GitHub API rate limit exceeded", message: "Try again in a few minutes." },
        { status: 429 }
      )
    }
    return NextResponse.json({ error: "Failed to sync request" }, { status: 500 })
  }
}
