import { NextRequest, NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { githubRequest } from "@/lib/github/rateAware"
import { getRateLimitBackoff, setRateLimitBackoff } from "@/lib/github/rateLimitState"
import { dispatchCleanup } from "@/lib/github/dispatchCleanup"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { needsRepair } from "@/lib/requests/syncPolicy"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getRequestCost } from "@/lib/services/cost-service"
import { env } from "@/lib/config/env"
import { ensureAssistantState } from "@/lib/assistant/state"
import { sendAdminNotification, formatRequestNotification } from "@/lib/notifications/email"

type ApplyRunLike = {
  runId?: number
  status?: string
  conclusion?: string
  headSha?: string
  url?: string
} | null | undefined

type DestroyRunLike = {
  runId?: number
  status?: string
  conclusion?: string
  headSha?: string
  url?: string
  completedAt?: string
} | null | undefined

/** True if the GitHub run is the destroy workflow (not plan/apply). */
function isDestroyWorkflowRun(runPath: string | undefined, destroyWorkflowFile: string): boolean {
  if (!runPath || !destroyWorkflowFile) return false
  return runPath.endsWith(destroyWorkflowFile) || runPath.includes(destroyWorkflowFile)
}

/**
 * Correlate a run to this request: head_sha in candidateShas, or run name contains requestId/branchName/PR number.
 */
function isDestroyRunCorrelated(
  runHeadSha: string | undefined,
  runName: string | undefined,
  candidateShas: Set<string>,
  requestId: string,
  branchName: string | undefined,
  prNumber: number | undefined
): boolean {
  if (runHeadSha && candidateShas.has(runHeadSha)) return true
  if (!runName) return false
  const r = runName.toLowerCase()
  if (requestId && r.includes(requestId.toLowerCase())) return true
  if (branchName && r.includes(branchName.toLowerCase())) return true
  if (prNumber != null && r.includes(String(prNumber))) return true
  return false
}

/**
 * Reconcile destroy run: only apply when run is the destroy workflow.
 * When we already have existing.runId (we stored it from destroy dispatch), we're refreshing that run by ID — trust it and require only workflow path match.
 * Correlation by head_sha/name is for discovery; when refreshing by runId we don't need it (destroy runs on targetBase so head_sha often isn't in candidateShas).
 */
function reconcileDestroyRun(
  existing: DestroyRunLike,
  fetched: { status?: string; conclusion?: string; head_sha?: string; completed_at?: string; html_url?: string; path?: string; name?: string },
  candidateShas: Set<string>,
  requestId: string,
  request: { branchName?: string; pr?: { number?: number } },
  destroyWorkflowFile: string
): DestroyRunLike {
  const runPath = fetched.path
  const runHeadSha = fetched.head_sha
  const runName = fetched.name
  const sameRunWeKnow = existing?.runId != null
  if (!runPath) return existing ?? undefined
  const isDestroy = isDestroyWorkflowRun(runPath, destroyWorkflowFile)
  if (!isDestroy) return existing ?? undefined
  const correlated = isDestroyRunCorrelated(
    runHeadSha,
    runName,
    candidateShas,
    requestId,
    request.branchName,
    request.pr?.number
  )
  if (!correlated && !sameRunWeKnow) return existing ?? undefined
  const existingActive = existing?.status === "queued" || existing?.status === "in_progress"
  const ghStatus = fetched.status
  const status =
    ghStatus === "queued" || ghStatus === "in_progress"
      ? ghStatus
      : ghStatus === "completed"
        ? "completed"
        : existing?.status
  const conclusion = ghStatus === "completed" ? (fetched.conclusion ?? existing?.conclusion) : undefined
  const completedAt = ghStatus === "completed" ? (fetched.completed_at ?? existing?.completedAt) : undefined
  if (existingActive && status === "completed" && existing?.runId) {
    return { ...existing, status, conclusion, completedAt, url: fetched.html_url ?? existing.url, headSha: runHeadSha ?? existing.headSha }
  }
  return {
    ...existing,
    runId: existing?.runId,
    status,
    conclusion,
    completedAt,
    url: fetched.html_url ?? existing?.url,
    headSha: runHeadSha ?? existing?.headSha,
  }
}

/**
 * Single-writer reconciliation: never clear an active (queued/in_progress) applyRun until
 * GitHub confirms completion or we have a positively correlated replacement.
 * When incoming is terminal (completed + conclusion), allow upgrade so request can leave "applying".
 */
function reconcileApplyRun(
  existing: ApplyRunLike,
  incoming: ApplyRunLike,
  candidateShas: Set<string>
): ApplyRunLike {
  const existingActive =
    existing?.status === "queued" || existing?.status === "in_progress"
  const incomingTerminal =
    incoming?.status === "completed" && incoming?.conclusion != null
  const incomingCorrelated = incoming?.headSha ? candidateShas.has(incoming.headSha) : false
  const sameRunId = existing?.runId && incoming?.runId && existing.runId === incoming.runId
  const sameRunByHeadSha =
    existing?.headSha && incoming?.headSha && existing.headSha === incoming.headSha
  const sameRunByUrl =
    existing?.url && incoming?.url && existing.url === incoming.url
  const sameRun = sameRunId || sameRunByHeadSha || sameRunByUrl
  const terminalCorrelates =
    incomingTerminal &&
    (sameRun || incomingCorrelated || (existing?.url && incoming?.url && existing.url === incoming.url))

  if (existingActive) {
    if (!incoming) return existing
    if (sameRun) return { ...existing, ...incoming }
    if (terminalCorrelates) return { ...existing, ...incoming }
    return existing
  }
  if (existing && !existingActive) {
    if (!incoming) return existing
    if (sameRun) return { ...existing, ...incoming }
    if (incomingCorrelated && incoming.runId !== existing.runId) return existing
    return existing
  }
  if (!existing && incoming && incomingCorrelated) return incoming
  if (!existing && incomingTerminal && incomingCorrelated) return incoming
  if (!existing && incoming && !incomingCorrelated) return undefined
  return existing ?? incoming ?? undefined
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes("rate limit") || msg.includes("rate limited")) return true
  }
  const status = (err as { status?: number })?.status
  return status === 403 || status === 429
}

function tfpilotOnlyResponse(
  request: Record<string, unknown>,
  syncExtra?: { degraded?: boolean; retryAfterMs?: number; reason?: string; scope?: "repo" | "global" }
) {
  const status = deriveLifecycleStatus(request as Parameters<typeof deriveLifecycleStatus>[0])
  return NextResponse.json({
    success: true,
    request: { ...request, status },
    sync: { mode: "tfpilot-only" as const, ...syncExtra },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const sessionOr401 = await requireSession()
    if (sessionOr401 instanceof NextResponse) return sessionOr401
    const { requestId } = await params
    const repair = req.nextUrl.searchParams.get("repair") === "1"
    const hydrate = req.nextUrl.searchParams.get("hydrate") === "1"

    const request = ensureAssistantState(await getRequest(requestId).catch(() => null))
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })

    const doGitHub = repair || hydrate || needsRepair(request)
    if (!doGitHub) {
      return tfpilotOnlyResponse(request)
    }

    const token = await getGitHubAccessToken(req)
    if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })

    const owner = request.targetOwner as string | undefined
    const repo = request.targetRepo as string | undefined
    const backoff = await getRateLimitBackoff(owner, repo)
    if (backoff.until && (backoff.retryAfterMs ?? 0) > 0) {
      const scope = owner && repo ? ("repo" as const) : ("global" as const)
      return tfpilotOnlyResponse(request, {
        degraded: true,
        retryAfterMs: backoff.retryAfterMs ?? 60_000,
        reason: "github_rate_limited",
        scope,
      })
    }

    // Single-writer: capture applyRun from DB and do not mutate until final reconciliation
    const existingApplyRun: ApplyRunLike = request.applyRun
      ? { ...request.applyRun }
      : request.applyRun

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

    try {
    if (request.pr?.number) {
      const prJson = await githubRequest<{
        merged?: boolean
        head?: { sha?: string }
        state?: string
        html_url?: string
        number?: number
        title?: string
        merge_commit_sha?: string | null
      }>({
        token,
        key: `gh:pr:${request.targetOwner}:${request.targetRepo}:${request.pr.number}`,
        ttlMs: 30_000,
        path: `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}`,
        context: { route: "requests/[requestId]/sync", correlationId: requestId },
      })
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
        const reviews = await githubRequest<Array<{ user?: { login?: string }; state?: string }>>({
          token,
          key: `gh:pr-reviews:${request.targetOwner}:${request.targetRepo}:${request.pr.number}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.pr.number}/reviews`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
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
        const cleanupJson = await githubRequest<Array<{
          number?: number
          html_url?: string
          state?: string
          merged_at?: string | null
          merged?: boolean
          head?: { ref?: string }
        }>>({
          token,
          key: `gh:cleanup-pr:${request.targetOwner}:${request.targetRepo}:${request.id}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/pulls?head=${encodeURIComponent(
            cleanupHead
          )}&state=all&per_page=1`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
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
        const runsJson = await githubRequest<{
          workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }>
        }>({
          token,
          key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${env.GITHUB_PLAN_WORKFLOW_FILE}:${request.branchName}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_PLAN_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
            request.branchName
          )}&per_page=3`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
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

    const candidateShas = new Set(
      [request.mergedSha, request.commitSha, request.planRun?.headSha, request.pr?.headSha].filter(Boolean) as string[]
    )

    let discoveredApplyRun: ApplyRunLike = null
    if (!existingApplyRun?.runId && env.GITHUB_APPLY_WORKFLOW_FILE) {
      try {
        const branchCandidates = [
          request.branchName,
          request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH ?? "main",
        ].filter(Boolean) as string[]
        for (const branch of branchCandidates) {
          const runsJson = await githubRequest<{
            workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }>
          }>({
            token,
            key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${env.GITHUB_APPLY_WORKFLOW_FILE}:${branch}`,
            ttlMs: 15_000,
            path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
              branch
            )}&per_page=5`,
            context: { route: "requests/[requestId]/sync", correlationId: requestId },
          })
          const firstRun =
            runsJson.workflow_runs?.find(
              (r) =>
                r.head_sha === existingApplyRun?.headSha ||
                r.head_sha === request.mergedSha ||
                r.head_sha === request.commitSha ||
                r.head_sha === request.planRun?.headSha
            ) ?? runsJson.workflow_runs?.[0]
          if (firstRun?.id) {
            discoveredApplyRun = {
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

    let hydratedExisting: ApplyRunLike = null
    if (existingApplyRun?.runId) {
      try {
        const runJson = await githubRequest<{
          status?: string
          conclusion?: string
          head_sha?: string
          html_url?: string
        }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${existingApplyRun.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${existingApplyRun.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        hydratedExisting = {
          ...existingApplyRun,
          status: runJson.status ?? existingApplyRun.status,
          conclusion: runJson.conclusion ?? existingApplyRun.conclusion,
          headSha: runJson.head_sha ?? existingApplyRun.headSha,
          url: runJson.html_url ?? existingApplyRun.url,
        }
      } catch {
        hydratedExisting = existingApplyRun
      }
    }

    let hydratedDiscovered: ApplyRunLike = null
    if (
      discoveredApplyRun?.runId &&
      (!existingApplyRun?.runId || discoveredApplyRun.runId !== existingApplyRun.runId)
    ) {
      try {
        const runJson = await githubRequest<{
          status?: string
          conclusion?: string
          head_sha?: string
          html_url?: string
        }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${discoveredApplyRun.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${discoveredApplyRun.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        hydratedDiscovered = {
          ...discoveredApplyRun,
          status: runJson.status ?? discoveredApplyRun.status,
          conclusion: runJson.conclusion ?? discoveredApplyRun.conclusion,
          headSha: runJson.head_sha ?? discoveredApplyRun.headSha,
          url: runJson.html_url ?? discoveredApplyRun.url,
        }
      } catch {
        hydratedDiscovered = discoveredApplyRun
      }
    }

    const incomingApplyRun: ApplyRunLike =
      existingApplyRun?.runId
        ? (hydratedExisting ?? existingApplyRun)
        : (hydratedDiscovered ?? (discoveredApplyRun?.headSha && candidateShas.has(discoveredApplyRun.headSha) ? discoveredApplyRun : null))

    const finalApplyRun = reconcileApplyRun(existingApplyRun, incomingApplyRun, candidateShas)
    request.applyRun = finalApplyRun ?? undefined
    if (finalApplyRun?.runId) {
      request.applyRunId = finalApplyRun.runId
      request.applyRunUrl = finalApplyRun.url
    } else {
      request.applyRunId = undefined
      request.applyRunUrl = undefined
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[sync applyRun] existing:", existingApplyRun?.runId, existingApplyRun?.status, "incoming:", incomingApplyRun?.runId, incomingApplyRun?.status, "final:", finalApplyRun?.runId, finalApplyRun?.status, "finalActive:", finalApplyRun?.status === "queued" || finalApplyRun?.status === "in_progress", "candidateShas:", Array.from(candidateShas))
    }

    if (request.planRun?.runId) {
      try {
        const runJson = await githubRequest<{ status?: string; conclusion?: string; head_sha?: string; html_url?: string }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${request.planRun.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.planRun.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        request.planRun = {
          ...request.planRun,
          status: runJson.status ?? request.planRun.status,
          conclusion: runJson.conclusion ?? request.planRun.conclusion,
          headSha: runJson.head_sha ?? request.planRun.headSha,
          url: runJson.html_url ?? request.planRun.url,
        }
        // Never fetch plan logs in sync (no PR files/diffs/logs)
      } catch {
        /* ignore */
      }
    }

    if (request.destroyRun?.runId) {
      try {
        const runJson = await githubRequest<{
          status?: string
          conclusion?: string
          head_sha?: string
          html_url?: string
          completed_at?: string
          path?: string
          name?: string
        }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${request.destroyRun.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${request.destroyRun.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        if (process.env.NODE_ENV === "development") {
          console.log("[sync destroyRun] candidate run:", {
            runId: request.destroyRun.runId,
            headSha: runJson.head_sha,
            status: runJson.status,
            conclusion: runJson.conclusion,
            path: runJson.path,
            name: runJson.name,
          })
        }
        const nextDestroyRun = reconcileDestroyRun(
          request.destroyRun,
          runJson,
          candidateShas,
          requestId,
          request,
          env.GITHUB_DESTROY_WORKFLOW_FILE
        )
        if (nextDestroyRun != null) {
          const applied = nextDestroyRun !== request.destroyRun
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[sync destroyRun]",
              applied ? "applied update (destroy workflow + correlated)" : "kept existing",
              "status:",
              nextDestroyRun.status,
              "conclusion:",
              nextDestroyRun.conclusion
            )
          }
          request.destroyRun = nextDestroyRun
        } else {
          if (process.env.NODE_ENV === "development") {
            console.log("[sync destroyRun] skipped update (run not destroy workflow or not correlated), preserving existing")
          }
        }
      } catch (err) {
        console.warn("[api/requests/sync] destroy run fetch failed for runId:", request.destroyRun?.runId, err)
      }
    }

    const status = deriveLifecycleStatus(request)
    const nowIso = new Date().toISOString()
    request.updatedAt = nowIso
    // Status is derived in response only; do not persist request.status

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

    // Optional repair: re-attempt cleanup dispatch if destroy success but dispatch previously failed
    if (repair && token) {
      const destroyRun = request.github?.workflows?.destroy ?? request.destroyRun
      const destroySuccess =
        destroyRun?.status === "completed" && destroyRun?.conclusion === "success"
      if (destroySuccess && request.github?.cleanupDispatchStatus === "error") {
        const nowIso = new Date().toISOString()
        await updateRequest(requestId, (current) => ({
          ...current,
          github: {
            ...current.github,
            cleanupDispatchStatus: "pending",
            cleanupDispatchAttemptedAt: nowIso,
            cleanupDispatchLastError: undefined,
          },
          updatedAt: nowIso,
        }))
        try {
          await dispatchCleanup({ token, requestId })
          await updateRequest(requestId, (current) => ({
            ...current,
            github: { ...current.github, cleanupDispatchStatus: "dispatched" },
            updatedAt: new Date().toISOString(),
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await updateRequest(requestId, (current) => ({
            ...current,
            github: {
              ...current.github,
              cleanupDispatchStatus: "error",
              cleanupDispatchLastError: message,
            },
            updatedAt: new Date().toISOString(),
          }))
        }
        request.updatedAt = new Date().toISOString()
      }
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

    const [updated] = await updateRequest(requestId, (current) => ({
      ...current,
      pr: request.pr,
      prNumber: request.prNumber ?? current.prNumber,
      prUrl: request.prUrl ?? current.prUrl,
      pullRequest: request.pullRequest ?? current.pullRequest,
      planRun: request.planRun,
      applyRun: finalApplyRun ?? undefined,
      approval: current.approval?.approved ? current.approval : (request.approval ?? current.approval),
      cleanupPr: request.cleanupPr,
      updatedAt: request.updatedAt,
      timeline: request.timeline,
      plan: request.plan,
      destroyRun: request.destroyRun,
      github: request.github ?? current.github,
    }))

    const cost = await getRequestCost(requestId)
    if (cost) {
      ;(updated as any).cost = cost
    }

    const derivedStatus = deriveLifecycleStatus(updated)
    return NextResponse.json({
      success: true,
      request: { ...updated, status: derivedStatus },
      sync: { mode: "repair" as const },
    })
    } catch (repairError) {
      if (isRateLimitError(repairError)) {
        const retryAfterMs = 60_000
        const owner = request.targetOwner as string | undefined
        const repo = request.targetRepo as string | undefined
        await setRateLimitBackoff(owner, repo, retryAfterMs, "github_rate_limited").catch(() => {})
        const scope = owner && repo ? ("repo" as const) : ("global" as const)
        return tfpilotOnlyResponse(request, {
          degraded: true,
          retryAfterMs,
          reason: "github_rate_limited",
          scope,
        })
      }
      throw repairError
    }
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
