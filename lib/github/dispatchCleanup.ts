/**
 * Dispatch the cleanup_v2 workflow (direct file deletion).
 * Single GitHub POST; request data is read from S3.
 */

import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"
import { env } from "@/lib/config/env"

export type DispatchCleanupParams = {
  token: string
  requestId: string
}

/**
 * Load request from S3 and dispatch cleanup_v2 workflow.
 * Requires environment_key and environment_slug (Model 2).
 */
export async function dispatchCleanup({ token, requestId }: DispatchCleanupParams): Promise<void> {
  const request = await getRequest(requestId)
  if (!request.targetOwner || !request.targetRepo || !env.GITHUB_CLEANUP_WORKFLOW_FILE) {
    return
  }
  const envKey = request.environment_key
  const envSlug = request.environment_slug ?? ""
  if (!envKey || envSlug === undefined || envSlug === "") {
    throw new Error("Request missing environment_key or environment_slug (Model 2 violation)")
  }
  const ref = request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH
  const isProd = (envKey ?? "").toLowerCase() === "prod"
  const module = request.module
  if (!module) {
    throw new Error("Request missing module (required for cleanup path)")
  }
  const inputs = {
    request_id: request.id,
    module,
    environment_key: envKey,
    environment_slug: envSlug,
    target_base: ref,
    auto_merge: isProd ? "false" : "true",
  }
  await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_CLEANUP_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref, inputs }),
  })
}
