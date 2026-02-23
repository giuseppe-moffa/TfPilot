import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { env } from "@/lib/config/env"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError } from "@/lib/observability/logger"
import { archiveRequest, getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const start = Date.now()
  const correlation = withCorrelation(req, {})
  let requestId: string | undefined
  try {
    const p = await params
    requestId = p.requestId
    if (!requestId) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role !== "admin") {
      return NextResponse.json({ error: "Destroy not permitted for your role" }, { status: 403 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const request = await getRequest(requestId).catch(() => null)
    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    if (!request.targetOwner || !request.targetRepo || !request.targetEnvPath) {
      return NextResponse.json({ error: "Request missing repo or env info" }, { status: 400 })
    }

    const isProd = request.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ error: "Prod destroy not allowed for this user" }, { status: 403 })
      }
    }

    // Additional prod destroy allowlist check (separate from general prod access)
    if (isProd && env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_DESTROY_PROD_ALLOWED_USERS.includes(session.login)) {
        await logLifecycleEvent({
          requestId: request.id,
          event: "destroy_blocked",
          actor: session.login,
          source: "api/requests/[requestId]/destroy",
          data: {
            reason: "not_in_destroy_prod_allowlist",
            environment: request.environment,
          },
        })
        return NextResponse.json({ error: "You're not allowed to destroy prod requests" }, { status: 403 })
      }
    }

    // Fire cleanup PR workflow first so code removal is ready before destroy completes
    if (env.GITHUB_CLEANUP_WORKFLOW_FILE && request.targetOwner && request.targetRepo) {
      const cleanupInputs = {
        request_id: request.id,
        environment: request.environment ?? "dev",
        target_base: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
        cleanup_paths: (request.targetFiles ?? []).join(","),
        target_env_path: request.targetEnvPath ?? "",
        auto_merge: isProd ? "false" : "true",
      }
      gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_CLEANUP_WORKFLOW_FILE}/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          ref: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
          inputs: cleanupInputs,
        }),
      }).catch((err) => {
        console.error("[api/requests/destroy] cleanup workflow dispatch failed", err)
      })
    }

    // Dispatch destroy workflow
    await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH,
        inputs: {
          request_id: request.id,
          environment: request.environment,
        },
      }),
    })

    // Brief delay so the newly triggered run appears first in the list
    await new Promise((r) => setTimeout(r, 2500))

    let destroyRunId: number | undefined
    let destroyRunUrl: string | undefined
    try {
      const runsRes = await gh(
        token,
        `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_DESTROY_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(
          request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH
        )}&per_page=1`
      )
      const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
      destroyRunId = runsJson.workflow_runs?.[0]?.id
      if (destroyRunId) {
        destroyRunUrl = `https://github.com/${request.targetOwner}/${request.targetRepo}/actions/runs/${destroyRunId}`
      }
    } catch {
      /* ignore run discovery failures */
    }

    const now = new Date().toISOString()
    const updated = await updateRequest(request.id, (current) => ({
      ...current,
      statusDerivedAt: now,
      destroyRun: {
        runId: destroyRunId ?? current.destroyRun?.runId,
        url: destroyRunUrl ?? current.destroyRun?.url,
        status: "in_progress",
      },
      cleanupPr: current.cleanupPr ?? { status: "pending" },
      updatedAt: now,
    }))

    await logLifecycleEvent({
      requestId: request.id,
      event: "destroy_dispatched",
      actor: session.login,
      source: "api/requests/[requestId]/destroy",
      data: {
        destroyRunId: destroyRunId ?? request.destroyRun?.runId,
        destroyRunUrl: destroyRunUrl ?? request.destroyRun?.url,
        targetRepo: `${request.targetOwner}/${request.targetRepo}`,
      },
    })

    // Write an archive copy under history/ while keeping the active tombstone
    try {
      await archiveRequest(updated)
    } catch (archiveError) {
      console.error("[api/requests/destroy] archive failed", archiveError)
    }

    return NextResponse.json({ ok: true, destroyRunId, destroyRunUrl, request: updated })
  } catch (error) {
    logError("github.dispatch_failed", error, { ...correlation, requestId, duration_ms: Date.now() - start })
    return NextResponse.json({ error: "Failed to dispatch destroy" }, { status: 500 })
  }
}
