/**
 * Shared persistence for workflow dispatch: tracked runId + triggeredAt + run index.
 * Use from plan/apply/destroy (and drift_plan when runId is available) dispatch routes
 * to avoid duplicated logic and ensure run-index + guard alignment.
 */

import type { WorkflowKind } from "@/lib/github/workflowClassification"
import { updateRequest } from "@/lib/storage/requestsStore"
import { putRunIndex } from "@/lib/requests/runIndex"

const TRIGGERED_AT_KEYS: Record<WorkflowKind, string> = {
  plan: "planTriggeredAt",
  apply: "applyTriggeredAt",
  destroy: "destroyTriggeredAt",
  cleanup: "cleanupTriggeredAt",
  drift_plan: "driftPlanTriggeredAt",
}

type RunFactShape = {
  runId: number
  url?: string
  status: string
  headSha?: string
}

/**
 * Build the minimal patch to persist a workflow run for a kind: github.workflows[kind] + triggeredAt + updatedAt.
 * Merge this into the request in your updateRequest callback along with route-specific fields (planRun, applyRun, etc.).
 */
export function buildWorkflowDispatchPatch(
  current: Record<string, unknown>,
  kind: WorkflowKind,
  runId: number,
  runUrl?: string
): Record<string, unknown> {
  const nowIso = new Date().toISOString()
  const cur = current as { github?: { workflows?: Record<string, unknown>; [k: string]: unknown } }
  const workflowPayload: RunFactShape = {
    runId,
    url: runUrl,
    status: "queued",
  }
  const triggeredAtKey = TRIGGERED_AT_KEYS[kind]
  return {
    github: {
      ...cur.github,
      workflows: {
        ...(cur.github?.workflows ?? {}),
        [kind]: workflowPayload,
      },
      ...(triggeredAtKey ? { [triggeredAtKey]: nowIso } : {}),
    },
    updatedAt: nowIso,
  }
}

/**
 * Write run → requestId to the S3 run index (fire-and-forget). Call after updateRequest that persists the run.
 */
export function persistWorkflowDispatchIndex(
  requestId: string,
  kind: WorkflowKind,
  runId: number
): void {
  putRunIndex(kind, runId, requestId).catch(() => {})
}

/**
 * Persist workflow dispatch: update request with github.workflows[kind] + triggeredAt, then write run index.
 * Use when the route can pass all other fields via merge(current); otherwise use buildWorkflowDispatchPatch + persistWorkflowDispatchIndex separately.
 */
export async function persistWorkflowDispatch(params: {
  requestId: string
  kind: WorkflowKind
  runId: number
  runUrl?: string
  merge?: (current: Record<string, unknown>) => Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { requestId, kind, runId, runUrl, merge } = params
  const [updated] = await updateRequest(requestId, (current) => {
    const patch = buildWorkflowDispatchPatch(current as Record<string, unknown>, kind, runId, runUrl)
    const extra = merge?.(current as Record<string, unknown>) ?? {}
    return { ...current, ...patch, ...extra }
  })
  persistWorkflowDispatchIndex(requestId, kind, runId)
  return updated
}
