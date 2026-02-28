import { NextRequest, NextResponse } from "next/server"
import { verifySignature } from "@/lib/github/webhook/verify"
import { hasDelivery, recordDelivery } from "@/lib/github/webhook/idempotency"
import {
  correlatePullRequest,
  correlateWorkflowRun,
  type PullRequestCorrelationPayload,
  type WorkflowRunCorrelationPayload,
} from "@/lib/github/correlation"
import { classifyWorkflowRun } from "@/lib/github/workflowClassification"
import { dispatchCleanup } from "@/lib/github/dispatchCleanup"
import {
  patchGithubPr,
  patchGithubReviews,
  patchRunsAttemptByRunId,
  type PullRequestWebhookPayload,
  type PullRequestReviewWebhookPayload,
  type WorkflowRunWebhookPayload,
} from "@/lib/requests/patchRequestFacts"
import { maybeEmitCompletionEvent } from "@/lib/logs/lifecycle"
import type { RunsState } from "@/lib/requests/runsModel"
import { getRequestIdByDestroyRunId, updateRequest } from "@/lib/storage/requestsStore"
import { getRequestIdByRunId } from "@/lib/requests/runIndex"
import { appendStreamEvent } from "@/lib/github/streamState"
import { env } from "@/lib/config/env"

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signatureHeader = req.headers.get("x-hub-signature-256")
  const secret = env.GITHUB_WEBHOOK_SECRET

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const event = req.headers.get("x-github-event")
  const deliveryId = req.headers.get("x-github-delivery")
  if (!deliveryId) {
    return NextResponse.json({ error: "Missing X-GitHub-Delivery" }, { status: 400 })
  }

  if (await hasDelivery(deliveryId)) {
    return NextResponse.json({ duplicate: true })
  }

  let payload: Record<string, unknown>
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (event === "pull_request") {
    const correlated = await correlatePullRequest(payload as PullRequestCorrelationPayload)
    if (correlated.requestId) {
      try {
        await updateRequest(correlated.requestId, (current) =>
          patchGithubPr(current, payload as PullRequestWebhookPayload)
        )
        await appendStreamEvent({
          requestId: correlated.requestId,
          updatedAt: new Date().toISOString(),
          type: event,
        }).catch(() => {})
      } catch {
        // Request may not exist or update conflict; still record delivery and return 200
      }
    }
  } else if (event === "pull_request_review") {
    const correlated = await correlatePullRequest(payload as PullRequestCorrelationPayload)
    if (correlated.requestId) {
      try {
        await updateRequest(correlated.requestId, (current) =>
          patchGithubReviews(current, payload as PullRequestReviewWebhookPayload)
        )
        await appendStreamEvent({
          requestId: correlated.requestId,
          updatedAt: new Date().toISOString(),
          type: event,
        }).catch(() => {})
      } catch {
        // Request may not exist or update conflict; still record delivery and return 200
      }
    }
  } else if (event === "workflow_run") {
    const kind = classifyWorkflowRun(payload as WorkflowRunWebhookPayload)
    const wr = (payload as WorkflowRunWebhookPayload).workflow_run

    if (process.env.DEBUG_WEBHOOKS === "1") {
      console.log("event=webhook.workflow_run.incoming", {
        deliveryId,
        kind: kind ?? "unknown",
        runId: wr?.id,
        status: wr?.status,
        conclusion: wr?.conclusion ?? null,
        head_sha: wr?.head_sha ?? null,
        workflow_name: wr?.name ?? null,
        display_title: wr?.display_title ?? null,
      })
    }

    // Prefer runId-based correlation for all kinds (O(1) index first, then fallbacks)
    let correlated: { requestId?: string }
    if (kind != null && wr?.id != null) {
      const requestIdIndexed = await getRequestIdByRunId(kind, wr.id)
      if (process.env.DEBUG_WEBHOOKS === "1") {
        if (requestIdIndexed != null) {
          console.log("event=webhook.correlation path=index_hit", {
            kind,
            runId: wr.id,
            requestId: requestIdIndexed,
          })
        } else {
          console.log("event=webhook.correlation path=index_miss", { kind, runId: wr.id })
        }
      }
      let requestIdByRunId: string | null = requestIdIndexed
      if (requestIdByRunId == null && kind === "destroy") {
        requestIdByRunId = await getRequestIdByDestroyRunId(wr.id)
      }
      if (requestIdByRunId == null) {
        const fallback = correlateWorkflowRun(payload as WorkflowRunCorrelationPayload)
        correlated = fallback
        if (process.env.DEBUG_WEBHOOKS === "1") {
          console.log("event=webhook.correlation path=fallback", {
            kind,
            runId: wr.id,
            requestId: fallback.requestId ?? null,
          })
        }
      } else {
        correlated = { requestId: requestIdByRunId }
      }
    } else {
      correlated = correlateWorkflowRun(payload as WorkflowRunCorrelationPayload)
      if (process.env.DEBUG_WEBHOOKS === "1") {
        console.log("event=webhook.correlation path=fallback", {
          kind: kind ?? "unknown",
          runId: wr?.id ?? null,
          requestId: correlated.requestId ?? null,
        })
      }
    }

    if (!correlated.requestId) {
      await recordDelivery(deliveryId, event ?? "unknown")
      return NextResponse.json({ ok: true })
    }
    if (kind == null) {
      if (process.env.DEBUG_WEBHOOKS === "1") {
        console.log(
          "event=webhook.workflow_run.unknown runId=%s name=%s displayTitle=%s",
          String(wr?.id ?? ""),
          wr?.name ?? "",
          wr?.display_title ?? ""
        )
      }
      await recordDelivery(deliveryId, event ?? "unknown")
      return NextResponse.json({ ok: true })
    }
    try {
      let patchHadChanges = false
      const [updated, saved] = await updateRequest(correlated.requestId, (current) => {
        const runsPatch = patchRunsAttemptByRunId(current, kind, payload as WorkflowRunWebhookPayload)
        patchHadChanges = Object.keys(runsPatch).length > 0
        return patchHadChanges ? { ...current, ...runsPatch } : current
      })
      if (process.env.DEBUG_WEBHOOKS === "1") {
        console.log("event=webhook.patch.result", {
          kind,
          runId: wr?.id,
          requestId: correlated.requestId,
          patchHadChanges,
          saved,
        })
      }
      if (kind != null && correlated.requestId && !patchHadChanges) {
        console.log(
          "event=webhook.patch.noop kind=%s runId=%s requestId=%s",
          kind,
          String(wr?.id ?? ""),
          correlated.requestId
        )
      }
      if (saved) {
        await appendStreamEvent({
          requestId: correlated.requestId,
          updatedAt: new Date().toISOString(),
          type: event ?? "workflow_run",
        }).catch(() => {})
      }
      // Emit completion lifecycle event only for the attempt that matches this runId (we never alter currentAttempt).
      // If matched attempt is null (e.g. late webhook for attempt 1 after attempt 2 dispatched), do not emit.
      if (
        saved &&
        (kind === "plan" || kind === "apply" || kind === "destroy") &&
        wr?.status === "completed" &&
        wr?.conclusion &&
        wr?.id != null
      ) {
        const runs = updated?.runs as RunsState | undefined
        const attempt = runs?.[kind]?.attempts?.find((a) => a.runId === wr.id)
        if (attempt != null && attempt.conclusion) {
          const actor =
            (wr as { actor?: { login?: string } }).actor?.login ??
            (payload as { sender?: { login?: string } }).sender?.login ??
            "github"
          await maybeEmitCompletionEvent(
            correlated.requestId,
            kind,
            wr.id,
            attempt.attempt,
            attempt.conclusion,
            "webhook",
            actor
          ).catch((err) => console.warn("[api/github/webhook] maybeEmitCompletionEvent failed", err))
        }
      }
      if (
        kind === "destroy" &&
        wr?.status === "completed" &&
        wr?.conclusion === "success" &&
        wr?.id != null
      ) {
        const runId = wr.id
        const [updated] = await updateRequest(correlated.requestId, (current) => {
          if (
            current.github?.cleanupTriggeredForDestroyRunId === runId &&
            current.github?.cleanupDispatchStatus === "dispatched"
          ) {
            return current
          }
          const nowIso = new Date().toISOString()
          return {
            ...current,
            github: {
              ...current.github,
              cleanupTriggeredForDestroyRunId: runId,
              cleanupDispatchStatus: "pending",
              cleanupDispatchAttemptedAt: nowIso,
              cleanupDispatchLastError: undefined,
            },
            updatedAt: nowIso,
          }
        })
        const shouldDispatch =
          updated.github?.cleanupTriggeredForDestroyRunId === runId &&
          updated.github?.cleanupDispatchStatus === "pending"
        if (shouldDispatch && env.GITHUB_SERVER_TOKEN) {
          try {
            await dispatchCleanup({
              token: env.GITHUB_SERVER_TOKEN,
              requestId: correlated.requestId,
            })
            await updateRequest(correlated.requestId, (current) => ({
              ...current,
              github: {
                ...current.github,
                cleanupDispatchStatus: "dispatched",
              },
              updatedAt: new Date().toISOString(),
            }))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error("[api/github/webhook] cleanup dispatch failed", err)
            await updateRequest(correlated.requestId, (current) => ({
              ...current,
              github: {
                ...current.github,
                cleanupDispatchStatus: "error",
                cleanupDispatchLastError: message,
              },
              updatedAt: new Date().toISOString(),
            }))
          }
        }
      }
    } catch {
      // Request may not exist or update conflict; still record delivery and return 200
    }
  }

  await recordDelivery(deliveryId, event ?? "unknown")
  return NextResponse.json({ ok: true })
}
