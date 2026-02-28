import { NextRequest, NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { githubRequest } from "@/lib/github/rateAware"
import { getRateLimitBackoff, setRateLimitBackoff } from "@/lib/github/rateLimitState"
import { dispatchCleanup } from "@/lib/github/dispatchCleanup"
import { maybeEmitCompletionEvent } from "@/lib/logs/lifecycle"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import {
  assertCurrentAttemptExists,
  ensureRuns,
  getCurrentAttemptStrict,
  isAttemptActive,
  needsReconcile,
  patchAttemptByRunId,
  patchAttemptRunId,
} from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { isLockExpired, type RequestLock } from "@/lib/requests/lock"
import { needsRepair } from "@/lib/requests/syncPolicy"
import { getRequestIdByRunId, putRunIndex } from "@/lib/requests/runIndex"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getRequestCost } from "@/lib/services/cost-service"
import { env } from "@/lib/config/env"
import { ensureAssistantState } from "@/lib/assistant/state"
import { sendAdminNotification, formatRequestNotification } from "@/lib/notifications/email"
import { logWarn } from "@/lib/observability/logger"

/** Cooldown after a reconcile fetch produced no patch (avoid hammering GitHub when status/conclusion missing). */
const RECONCILE_NOOP_COOLDOWN_MS = 60_000
const MAX_RECONCILE_COOLDOWN_ENTRIES = 2000
const reconcileNoopAt = new Map<string, number>()

/** Cooldown for runId discovery (list workflow runs) when no candidate found or attach was noop. */
const DISCOVERY_COOLDOWN_MS = 60_000
const MAX_DISCOVERY_COOLDOWN_ENTRIES = 2000
const discoveryNoopAt = new Map<string, number>()

function discoveryCooldownKey(requestId: string, kind: string, attemptNumber: number): string {
  return `discovery:${requestId}:${kind}:${attemptNumber}`
}

function isInDiscoveryCooldown(requestId: string, kind: string, attemptNumber: number): boolean {
  const key = discoveryCooldownKey(requestId, kind, attemptNumber)
  const at = discoveryNoopAt.get(key)
  if (at == null) return false
  return Date.now() - at < DISCOVERY_COOLDOWN_MS
}

function setDiscoveryCooldown(requestId: string, kind: string, attemptNumber: number): void {
  if (discoveryNoopAt.size >= MAX_DISCOVERY_COOLDOWN_ENTRIES) {
    const oldest = [...discoveryNoopAt.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) discoveryNoopAt.delete(oldest[0])
  }
  discoveryNoopAt.set(discoveryCooldownKey(requestId, kind, attemptNumber), Date.now())
}

const CREATED_AT_TOLERANCE_MS = 5_000

function reconcileCooldownKey(requestId: string, kind: string, runId: number): string {
  return `reconcile:${requestId}:${kind}:${runId}`
}

function isInReconcileCooldown(requestId: string, kind: string, runId: number): boolean {
  const key = reconcileCooldownKey(requestId, kind, runId)
  const at = reconcileNoopAt.get(key)
  if (at == null) return false
  return Date.now() - at < RECONCILE_NOOP_COOLDOWN_MS
}

function setReconcileCooldown(requestId: string, kind: string, runId: number): void {
  if (reconcileNoopAt.size >= MAX_RECONCILE_COOLDOWN_ENTRIES) {
    const oldest = [...reconcileNoopAt.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) reconcileNoopAt.delete(oldest[0])
  }
  reconcileNoopAt.set(reconcileCooldownKey(requestId, kind, runId), Date.now())
}

/** True when GitHub run payload has terminal state (completed + conclusion); do not cooldown in that case. */
function isRunPayloadTerminal(gh: { status?: string; conclusion?: string | null }): boolean {
  return gh.status === "completed" && gh.conclusion != null && String(gh.conclusion).trim() !== ""
}

/** True if the GitHub run is the destroy workflow (not plan/apply). */
function isDestroyWorkflowRun(runPath: string | undefined, destroyWorkflowFile: string): boolean {
  if (!runPath || !destroyWorkflowFile) return false
  return runPath.endsWith(destroyWorkflowFile) || runPath.includes(destroyWorkflowFile)
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

    let request = ensureAssistantState(await getRequest(requestId).catch(() => null))
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })

    ensureRuns(request as Record<string, unknown>)

    // Clear expired lock so actions are not blocked; persist only if changed
    const lock = request.lock as RequestLock | undefined
    if (lock && isLockExpired(lock, new Date())) {
      const [updated, saved] = await updateRequest(requestId, (c) => ({
        ...c,
        lock: undefined,
        updatedAt: new Date().toISOString(),
      }))
      if (saved) {
        request = updated
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log(JSON.stringify({ event: "sync.lock_cleared_expired", requestId }))
        }
      }
    }

    const runsForGate = request.runs as RunsState
    const planAttemptGate = getCurrentAttemptStrict(runsForGate, "plan")
    const applyAttemptGate = getCurrentAttemptStrict(runsForGate, "apply")
    const destroyAttemptGate = getCurrentAttemptStrict(runsForGate, "destroy")
    const hasActiveAttemptNeedingFetch =
      (planAttemptGate != null && (isAttemptActive(planAttemptGate) || needsReconcile(planAttemptGate))) ||
      (applyAttemptGate != null && (isAttemptActive(applyAttemptGate) || needsReconcile(applyAttemptGate))) ||
      (destroyAttemptGate != null && (isAttemptActive(destroyAttemptGate) || needsReconcile(destroyAttemptGate)))

    const doGitHub = repair || hydrate || needsRepair(request) || hasActiveAttemptNeedingFetch
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

    ensureRuns(request as Record<string, unknown>)
    const runs = request.runs as RunsState
    assertCurrentAttemptExists(runs, "plan")
    assertCurrentAttemptExists(runs, "apply")
    assertCurrentAttemptExists(runs, "destroy")

    const planAttempt = getCurrentAttemptStrict(runs, "plan")
    let applyAttempt = getCurrentAttemptStrict(runs, "apply")
    let destroyAttempt = getCurrentAttemptStrict(runs, "destroy")

    // Previous state for email deduplication
    const previousPlanConclusion = planAttempt?.conclusion
    const previousApplyConclusion = applyAttempt?.conclusion
    const previousDestroyConclusion = destroyAttempt?.conclusion

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

    const candidateShas = new Set(
      [request.mergedSha, request.commitSha, planAttempt?.headSha, request.pr?.headSha].filter(Boolean) as string[]
    )

    const PLAN_WORKFLOW = env.GITHUB_PLAN_WORKFLOW_FILE
    if (planAttempt && planAttempt.runId == null && request.branchName) {
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.plan_discovery_attempt", { requestId, attempt: planAttempt.attempt })
        }
        const runsJson = await githubRequest<{ workflow_runs?: Array<{ id: number; html_url?: string }> }>({
          token,
          key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${PLAN_WORKFLOW}:${request.branchName}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(
            request.branchName as string
          )}&per_page=1`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const firstRun = runsJson.workflow_runs?.[0]
        if (firstRun?.id) {
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.plan_discovery_found", { requestId, runId: firstRun.id })
          }
          const patched = patchAttemptRunId(request.runs as RunsState, "plan", planAttempt.attempt, {
            runId: firstRun.id,
            url: firstRun.html_url,
          })
          if (patched) {
            request.runs = patched
            putRunIndex("plan", firstRun.id, requestId).catch(() => {})
            const runJson = await githubRequest<{
              status?: string
              conclusion?: string
              head_sha?: string
              html_url?: string
              completed_at?: string
            }>({
              token,
              key: `gh:run:${request.targetOwner}:${request.targetRepo}:${firstRun.id}`,
              ttlMs: 10_000,
              path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${firstRun.id}`,
              context: { route: "requests/[requestId]/sync", correlationId: requestId },
            })
            const planPatch = patchAttemptByRunId(request.runs as RunsState, "plan", firstRun.id, {
              status: runJson.status,
              conclusion: runJson.conclusion ?? undefined,
              completed_at: runJson.completed_at,
              head_sha: runJson.head_sha,
            })
            if (planPatch) request.runs = planPatch
            if (
              planPatch &&
              runJson.status === "completed" &&
              runJson.conclusion &&
              planAttempt.attempt != null
            ) {
              await maybeEmitCompletionEvent(
                requestId,
                "plan",
                firstRun.id,
                planAttempt.attempt,
                runJson.conclusion,
                "sync",
                "system"
              ).catch((err) =>
                console.warn("[api/requests/sync] maybeEmitCompletionEvent failed", { kind: "plan", requestId, err })
              )
            }
          }
        } else {
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.plan_discovery_skipped", { requestId, reason: "no candidates" })
          }
        }
      } catch (err) {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.plan_discovery_skipped", { requestId, reason: "error", err: String(err) })
        }
      }
    }

    // Apply runId discovery: list workflow runs when current apply attempt has no runId and no conclusion
    const applyNeedsDiscovery =
      applyAttempt != null &&
      applyAttempt.runId == null &&
      (applyAttempt.conclusion == null || applyAttempt.conclusion === undefined) &&
      !isInDiscoveryCooldown(requestId, "apply", applyAttempt.attempt)
    if (applyNeedsDiscovery && applyAttempt != null) {
      const applyAttemptForDiscovery = applyAttempt
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.apply_discovery_attempt", { requestId, attempt: applyAttemptForDiscovery.attempt })
        }
        const applyRef = (request.branchName ?? request.targetBase ?? "main") as string
        const APPLY_WORKFLOW = env.GITHUB_APPLY_WORKFLOW_FILE
        const runsJson = await githubRequest<{
          workflow_runs?: Array<{ id: number; created_at?: string; head_branch?: string; html_url?: string }>
        }>({
          token,
          key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${APPLY_WORKFLOW}:apply-discovery:${requestId}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${APPLY_WORKFLOW}/runs?branch=${encodeURIComponent(
            applyRef
          )}&per_page=30`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const runs = runsJson.workflow_runs ?? []
        const dispatchedMs = applyAttemptForDiscovery.dispatchedAt ? new Date(applyAttemptForDiscovery.dispatchedAt).getTime() : 0
        const minCreatedTs = dispatchedMs ? dispatchedMs - CREATED_AT_TOLERANCE_MS : 0
        const candidates = runs
          .filter((r) => {
            const created = r.created_at ? Date.parse(r.created_at) : NaN
            return !Number.isNaN(created) && created >= minCreatedTs && (r.head_branch == null || r.head_branch === applyRef)
          })
          .sort((a, b) => {
            const ta = a.created_at ? Date.parse(a.created_at) : 0
            const tb = b.created_at ? Date.parse(b.created_at) : 0
            return ta - tb
          })
        let foundRunId: number | undefined
        let foundUrl: string | undefined
        for (const run of candidates) {
          const existingRequestId = await getRequestIdByRunId("apply", run.id)
          if (existingRequestId != null && existingRequestId !== requestId) continue
          foundRunId = run.id
          foundUrl = run.html_url ?? `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${run.id}`
          break
        }
        if (foundRunId != null && foundUrl != null) {
          const patched = patchAttemptRunId(request.runs as RunsState, "apply", applyAttemptForDiscovery.attempt, {
            runId: foundRunId,
            url: foundUrl,
          })
          if (patched) {
            request.runs = patched
            putRunIndex("apply", foundRunId, requestId).catch(() => {})
            if (process.env.DEBUG_WEBHOOKS === "1") {
              console.log("event=sync.apply_discovery_found", { requestId, runId: foundRunId })
            }
          } else {
            setDiscoveryCooldown(requestId, "apply", applyAttemptForDiscovery.attempt)
            if (process.env.DEBUG_WEBHOOKS === "1") {
              console.log("event=sync.apply_discovery_skipped", { requestId, reason: "attach noop" })
            }
          }
        } else {
          setDiscoveryCooldown(requestId, "apply", applyAttemptForDiscovery.attempt)
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.apply_discovery_skipped", {
              requestId,
              reason: candidates.length === 0 ? "no candidates" : "all candidates claimed",
            })
          }
        }
      } catch (err) {
        setDiscoveryCooldown(requestId, "apply", applyAttemptForDiscovery.attempt)
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.apply_discovery_skipped", { requestId, reason: "error", err: String(err) })
        }
      }
    }

    // Re-read after discovery may have attached runId
    applyAttempt = getCurrentAttemptStrict(request.runs as RunsState, "apply")

    // Reconcile apply when we have runId but no conclusion (covers queued/in_progress and stuck "unknown")
    const applyEligible = applyAttempt != null && needsReconcile(applyAttempt)
    const applyInCooldown =
      applyAttempt?.runId != null && isInReconcileCooldown(requestId, "apply", applyAttempt.runId)
    if (process.env.DEBUG_WEBHOOKS === "1") {
      console.log("event=sync.apply_reconcile", {
        requestId,
        eligible: applyEligible,
        skippedCooldown: applyInCooldown,
        reason: applyEligible
          ? applyInCooldown
            ? "in cooldown after prior noop reconcile"
            : "runId present, conclusion missing"
          : !applyAttempt
            ? "no current apply attempt"
            : applyAttempt.runId == null
              ? "no runId"
              : "has conclusion",
      })
    }
    if (applyInCooldown && applyAttempt?.runId != null && process.env.DEBUG_WEBHOOKS === "1") {
      const key = reconcileCooldownKey(requestId, "apply", applyAttempt.runId)
      const at = reconcileNoopAt.get(key) ?? 0
      const remainingMs = Math.max(0, RECONCILE_NOOP_COOLDOWN_MS - (Date.now() - at))
      console.log("event=sync.reconcile_skipped_cooldown", {
        kind: "apply",
        runId: applyAttempt.runId,
        requestId,
        remainingMs,
      })
    }
    if (applyEligible && applyAttempt != null && applyAttempt.runId != null && !applyInCooldown) {
      const currentApply = applyAttempt
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.fetch_run", {
            kind: "apply",
            runId: currentApply.runId,
            requestId,
            status_before: currentApply.status,
          })
        }
        const runJson = await githubRequest<{
          status?: string
          conclusion?: string
          head_sha?: string
          html_url?: string
          completed_at?: string
        }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${currentApply.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${currentApply.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const applyPatch = patchAttemptByRunId(request.runs as RunsState, "apply", currentApply.runId!, {
          status: runJson.status,
          conclusion: runJson.conclusion ?? undefined,
          completed_at: runJson.completed_at,
          head_sha: runJson.head_sha,
        })
        if (!applyPatch && currentApply.runId != null && !isRunPayloadTerminal(runJson)) {
          setReconcileCooldown(requestId, "apply", currentApply.runId)
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.reconcile_cooldown_set", {
              kind: "apply",
              runId: currentApply.runId,
              requestId,
              reason: "noop + nonterminal payload",
            })
          }
        }
        if (process.env.DEBUG_WEBHOOKS === "1" && applyPatch) {
          console.log("event=sync.patch_run", {
            kind: "apply",
            runId: currentApply.runId,
            old_status: currentApply.status,
            new_status: runJson.status,
          })
        }
        if (applyPatch) request.runs = applyPatch
        // Emit completion only for this run (current attempt we just patched); never touch currentAttempt
        if (
          applyPatch &&
          runJson.status === "completed" &&
          runJson.conclusion &&
          currentApply.attempt != null
        ) {
          await maybeEmitCompletionEvent(
            requestId,
            "apply",
            currentApply.runId!,
            currentApply.attempt,
            runJson.conclusion,
            "sync",
            "system"
          ).catch((err) =>
            console.warn("[api/requests/sync] maybeEmitCompletionEvent failed", { kind: "apply", requestId, err })
          )
        }
      } catch {
        /* ignore */
      }
    }

    // Reconcile plan when we have runId but no conclusion (same invariant as apply/destroy)
    const planEligible = planAttempt != null && needsReconcile(planAttempt)
    const planInCooldown =
      planAttempt?.runId != null && isInReconcileCooldown(requestId, "plan", planAttempt.runId)
    if (process.env.DEBUG_WEBHOOKS === "1") {
      console.log("event=sync.plan_reconcile", {
        requestId,
        eligible: planEligible,
        skippedCooldown: planInCooldown,
        reason: planEligible
          ? planInCooldown
            ? "in cooldown after prior noop reconcile"
            : "runId present, conclusion missing"
          : !planAttempt
            ? "no current plan attempt"
            : planAttempt.runId == null
              ? "no runId"
              : "has conclusion",
      })
    }
    if (planInCooldown && planAttempt?.runId != null && process.env.DEBUG_WEBHOOKS === "1") {
      const key = reconcileCooldownKey(requestId, "plan", planAttempt.runId)
      const at = reconcileNoopAt.get(key) ?? 0
      const remainingMs = Math.max(0, RECONCILE_NOOP_COOLDOWN_MS - (Date.now() - at))
      console.log("event=sync.reconcile_skipped_cooldown", {
        kind: "plan",
        runId: planAttempt.runId,
        requestId,
        remainingMs,
      })
    }
    if (planEligible && planAttempt.runId != null && !planInCooldown) {
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.fetch_run", {
            kind: "plan",
            runId: planAttempt.runId,
            requestId,
            status_before: planAttempt.status,
          })
        }
        const runJson = await githubRequest<{
          status?: string
          conclusion?: string
          head_sha?: string
          html_url?: string
          completed_at?: string
        }>({
          token,
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${planAttempt.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${planAttempt.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const planPatch = patchAttemptByRunId(request.runs as RunsState, "plan", planAttempt.runId, {
          status: runJson.status,
          conclusion: runJson.conclusion ?? undefined,
          completed_at: runJson.completed_at,
          head_sha: runJson.head_sha,
        })
        if (!planPatch && planAttempt.runId != null && !isRunPayloadTerminal(runJson)) {
          setReconcileCooldown(requestId, "plan", planAttempt.runId)
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.reconcile_cooldown_set", {
              kind: "plan",
              runId: planAttempt.runId,
              requestId,
              reason: "noop + nonterminal payload",
            })
          }
        }
        if (process.env.DEBUG_WEBHOOKS === "1" && planPatch) {
          console.log("event=sync.patch_run", {
            kind: "plan",
            runId: planAttempt.runId,
            old_status: planAttempt.status,
            new_status: runJson.status,
          })
        }
        if (planPatch) request.runs = planPatch
        // Emit completion only for this run (current attempt we just patched); never touch currentAttempt
        if (
          planPatch &&
          runJson.status === "completed" &&
          runJson.conclusion &&
          planAttempt.attempt != null
        ) {
          await maybeEmitCompletionEvent(
            requestId,
            "plan",
            planAttempt.runId,
            planAttempt.attempt,
            runJson.conclusion,
            "sync",
            "system"
          ).catch((err) =>
            console.warn("[api/requests/sync] maybeEmitCompletionEvent failed", { kind: "plan", requestId, err })
          )
        }
      } catch {
        /* ignore */
      }
    }

    // Destroy runId discovery: list workflow runs when current destroy attempt has no runId and no conclusion
    const destroyNeedsDiscovery =
      destroyAttempt != null &&
      destroyAttempt.runId == null &&
      (destroyAttempt.conclusion == null || destroyAttempt.conclusion === undefined) &&
      !isInDiscoveryCooldown(requestId, "destroy", destroyAttempt.attempt)
    if (destroyNeedsDiscovery && destroyAttempt != null) {
      const destroyAttemptForDiscovery = destroyAttempt
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.destroy_discovery_attempt", { requestId, attempt: destroyAttemptForDiscovery.attempt })
        }
        const destroyRef = (request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH ?? "main") as string
        const DESTROY_WORKFLOW = env.GITHUB_DESTROY_WORKFLOW_FILE
        const runsJson = await githubRequest<{
          workflow_runs?: Array<{ id: number; created_at?: string; head_branch?: string; html_url?: string }>
        }>({
          token,
          key: `gh:wf-runs:${request.targetOwner}:${request.targetRepo}:${DESTROY_WORKFLOW}:destroy-discovery:${requestId}`,
          ttlMs: 15_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${DESTROY_WORKFLOW}/runs?branch=${encodeURIComponent(
            destroyRef
          )}&per_page=30`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const runs = runsJson.workflow_runs ?? []
        const dispatchedMs = destroyAttemptForDiscovery.dispatchedAt ? new Date(destroyAttemptForDiscovery.dispatchedAt).getTime() : 0
        const minCreatedTs = dispatchedMs ? dispatchedMs - CREATED_AT_TOLERANCE_MS : 0
        const candidates = runs
          .filter((r) => {
            const created = r.created_at ? Date.parse(r.created_at) : NaN
            return !Number.isNaN(created) && created >= minCreatedTs && (r.head_branch == null || r.head_branch === destroyRef)
          })
          .sort((a, b) => {
            const ta = a.created_at ? Date.parse(a.created_at) : 0
            const tb = b.created_at ? Date.parse(b.created_at) : 0
            return ta - tb
          })
        let foundRunId: number | undefined
        let foundUrl: string | undefined
        for (const run of candidates) {
          const existingRequestId = await getRequestIdByRunId("destroy", run.id)
          if (existingRequestId != null && existingRequestId !== requestId) continue
          foundRunId = run.id
          foundUrl = run.html_url ?? `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${run.id}`
          break
        }
        if (foundRunId != null && foundUrl != null) {
          const patched = patchAttemptRunId(request.runs as RunsState, "destroy", destroyAttemptForDiscovery.attempt, {
            runId: foundRunId,
            url: foundUrl,
          })
          if (patched) {
            request.runs = patched
            putRunIndex("destroy", foundRunId, requestId).catch(() => {})
            if (process.env.DEBUG_WEBHOOKS === "1") {
              console.log("event=sync.destroy_discovery_found", { requestId, runId: foundRunId })
            }
          } else {
            setDiscoveryCooldown(requestId, "destroy", destroyAttemptForDiscovery.attempt)
            if (process.env.DEBUG_WEBHOOKS === "1") {
              console.log("event=sync.destroy_discovery_skipped", { requestId, reason: "attach noop" })
            }
          }
        } else {
          setDiscoveryCooldown(requestId, "destroy", destroyAttemptForDiscovery.attempt)
          if (process.env.DEBUG_WEBHOOKS === "1") {
            console.log("event=sync.destroy_discovery_skipped", {
              requestId,
              reason: candidates.length === 0 ? "no candidates" : "all candidates claimed",
            })
          }
        }
      } catch (err) {
        setDiscoveryCooldown(requestId, "destroy", destroyAttemptForDiscovery.attempt)
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.destroy_discovery_skipped", { requestId, reason: "error", err: String(err) })
        }
      }
    }

    // Re-read after discovery may have attached runId
    destroyAttempt = getCurrentAttemptStrict(request.runs as RunsState, "destroy")

    // Reconcile destroy when we have runId but no conclusion (same invariant as apply)
    const destroyEligible = destroyAttempt != null && needsReconcile(destroyAttempt)
    const destroyInCooldown =
      destroyAttempt?.runId != null && isInReconcileCooldown(requestId, "destroy", destroyAttempt.runId)
    if (process.env.DEBUG_WEBHOOKS === "1") {
      console.log("event=sync.destroy_reconcile", {
        requestId,
        eligible: destroyEligible,
        skippedCooldown: destroyInCooldown,
        reason: destroyEligible
          ? destroyInCooldown
            ? "in cooldown after prior noop reconcile"
            : "runId present, conclusion missing"
          : !destroyAttempt
            ? "no current destroy attempt"
            : destroyAttempt.runId == null
              ? "no runId"
              : "has conclusion",
      })
    }
    if (destroyInCooldown && destroyAttempt?.runId != null && process.env.DEBUG_WEBHOOKS === "1") {
      const key = reconcileCooldownKey(requestId, "destroy", destroyAttempt.runId)
      const at = reconcileNoopAt.get(key) ?? 0
      const remainingMs = Math.max(0, RECONCILE_NOOP_COOLDOWN_MS - (Date.now() - at))
      console.log("event=sync.reconcile_skipped_cooldown", {
        kind: "destroy",
        runId: destroyAttempt.runId,
        requestId,
        remainingMs,
      })
    }
    if (destroyEligible && destroyAttempt != null && destroyAttempt.runId != null && !destroyInCooldown) {
      const currentDestroy = destroyAttempt
      try {
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=sync.fetch_run", {
            kind: "destroy",
            runId: currentDestroy.runId,
            requestId,
            status_before: currentDestroy.status,
          })
        }
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
          key: `gh:run:${request.targetOwner}:${request.targetRepo}:${currentDestroy.runId}`,
          ttlMs: 10_000,
          path: `/repos/${request.targetOwner}/${request.targetRepo}/actions/runs/${currentDestroy.runId}`,
          context: { route: "requests/[requestId]/sync", correlationId: requestId },
        })
        const isDestroy = isDestroyWorkflowRun(runJson.path, env.GITHUB_DESTROY_WORKFLOW_FILE)
        if (isDestroy) {
          const destroyPatch = patchAttemptByRunId(request.runs as RunsState, "destroy", currentDestroy.runId!, {
            status: runJson.status,
            conclusion: runJson.conclusion ?? undefined,
            completed_at: runJson.completed_at,
            head_sha: runJson.head_sha,
          })
          if (!destroyPatch && currentDestroy.runId != null && !isRunPayloadTerminal(runJson)) {
            setReconcileCooldown(requestId, "destroy", currentDestroy.runId)
            if (process.env.DEBUG_WEBHOOKS === "1") {
              console.log("event=sync.reconcile_cooldown_set", {
                kind: "destroy",
                runId: currentDestroy.runId,
                requestId,
                reason: "noop + nonterminal payload",
              })
            }
          }
          if (process.env.DEBUG_WEBHOOKS === "1" && destroyPatch) {
            console.log("event=sync.patch_run", {
              kind: "destroy",
              runId: currentDestroy.runId,
              old_status: currentDestroy.status,
              new_status: runJson.status,
            })
          }
          if (destroyPatch) request.runs = destroyPatch
          // Emit completion only for this run (current attempt we just patched); never touch currentAttempt
          if (
            destroyPatch &&
            runJson.status === "completed" &&
            runJson.conclusion &&
            currentDestroy.attempt != null
          ) {
            await maybeEmitCompletionEvent(
              requestId,
              "destroy",
              currentDestroy.runId!,
              currentDestroy.attempt,
              runJson.conclusion,
              "sync",
              "system"
            ).catch((err) =>
              console.warn("[api/requests/sync] maybeEmitCompletionEvent failed", {
                kind: "destroy",
                requestId,
                err,
              })
            )
          }
        }
      } catch (err) {
        console.warn("[api/requests/sync] destroy run fetch failed for runId:", currentDestroy.runId, err)
      }
    }

    const status = deriveLifecycleStatus(request)
    const nowIso = new Date().toISOString()
    request.updatedAt = nowIso
    // Status is derived in response only; do not persist request.status

    const latestApply = getCurrentAttemptStrict(request.runs as RunsState, "apply")
    const latestDestroy = getCurrentAttemptStrict(request.runs as RunsState, "destroy")
    const latestPlan = getCurrentAttemptStrict(request.runs as RunsState, "plan")

    // Email notifications on lifecycle transitions (deduplicated by checking previous state)
    if (latestApply?.conclusion && latestApply.conclusion !== previousApplyConclusion) {
      const actor = latestApply.conclusion === "success" ? (request.approval?.approvers?.[0] || "system") : "system"
      if (latestApply.conclusion === "success") {
        const { subject, body } = formatRequestNotification("apply_success", request, actor, latestApply.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send apply_success email", err)
        )
      } else if (latestApply.conclusion === "failure") {
        const { subject, body } = formatRequestNotification("apply_failed", request, actor, latestApply.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send apply_failed email", err)
        )
      }
    }
    if (latestDestroy?.conclusion && latestDestroy.conclusion !== previousDestroyConclusion) {
      const actor = "system"
      if (latestDestroy.conclusion === "success") {
        const { subject, body } = formatRequestNotification("destroy_success", request, actor, latestDestroy.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send destroy_success email", err)
        )
      } else if (latestDestroy.conclusion === "failure") {
        const { subject, body } = formatRequestNotification("destroy_failed", request, actor, latestDestroy.url)
        await sendAdminNotification(subject, body).catch((err) =>
          console.error("[api/requests/sync] failed to send destroy_failed email", err)
        )
      }
    }
    if (latestPlan?.conclusion === "failure" && latestPlan.conclusion !== previousPlanConclusion) {
      const actor = "system"
      const { subject, body } = formatRequestNotification("plan_failed", request, actor, latestPlan.url)
      await sendAdminNotification(subject, body).catch((err) =>
        console.error("[api/requests/sync] failed to send plan_failed email", err)
      )
    }

    // Optional repair: re-attempt cleanup dispatch if destroy success but dispatch previously failed
    if (repair && token) {
      const destroySuccess =
        latestDestroy?.status === "completed" && latestDestroy?.conclusion === "success"
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
      approval: current.approval?.approved ? current.approval : (request.approval ?? current.approval),
      cleanupPr: request.cleanupPr,
      updatedAt: request.updatedAt,
      timeline: request.timeline,
      plan: request.plan,
      runs: request.runs,
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
