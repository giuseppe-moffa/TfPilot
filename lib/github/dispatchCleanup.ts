/**
 * Dispatch the cleanup workflow (e.g. after destroy succeeds via webhook).
 * Single GitHub POST; request data is read from S3.
 */

import { gh } from "@/lib/github/client"
import { getRequest } from "@/lib/storage/requestsStore"
import { env } from "@/lib/config/env"
import { getEnvTargetFile, getModuleType } from "@/lib/infra/moduleType"

export type DispatchCleanupParams = {
  token: string
  requestId: string
}

/**
 * Load request from S3 and dispatch cleanup workflow (1 GitHub call).
 * Caller must supply a token (e.g. server token for webhook, or user token for destroy route).
 */
export async function dispatchCleanup({ token, requestId }: DispatchCleanupParams): Promise<void> {
  const request = await getRequest(requestId)
  if (!request.targetOwner || !request.targetRepo || !env.GITHUB_CLEANUP_WORKFLOW_FILE) {
    return
  }
  const ref = request.targetBase ?? env.GITHUB_DEFAULT_BASE_BRANCH
  const targetFiles = request.targetFiles ?? []
  const cleanupPaths =
    targetFiles.length > 0
      ? targetFiles.join(",")
      : request.targetEnvPath && request.module
        ? getEnvTargetFile(request.targetEnvPath, getModuleType(request.module))
        : ""
  const isProd = (request.environment ?? "").toLowerCase() === "prod"
  const inputs = {
    request_id: request.id,
    environment: request.environment ?? "dev",
    target_base: ref,
    cleanup_paths: cleanupPaths,
    target_env_path: request.targetEnvPath ?? "",
    auto_merge: isProd ? "false" : "true",
  }
  await gh(token, `/repos/${request.targetOwner}/${request.targetRepo}/actions/workflows/${env.GITHUB_CLEANUP_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref, inputs }),
  })
}
