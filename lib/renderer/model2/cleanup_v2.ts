/**
 * Model 2 cleanup — direct file deletion, no marker scanning.
 * Staged for Phase 3 cutover — not used by request routes until atomic flip.
 * Delete exactly envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf
 */

import { computeRequestTfPath } from "./paths"

/** Regex: must be under tfpilot/requests/ and be <module>_req_<id>.tf; module [a-z0-9-], id [A-Za-z0-9_-] */
const SAFE_CLEANUP_PATTERN = /^envs\/[^/]+\/[^/]+\/tfpilot\/requests\/[a-z0-9-]+_req_[A-Za-z0-9_-]+\.tf$/

export type AssertCleanupPathSafeResult = { ok: true } | { ok: false; error: string }

/**
 * Ensures path is under tfpilot/requests and matches <module>_req_<id>.tf. Rejects path traversal and off-target paths.
 */
export function assertCleanupPathSafe(path: string): AssertCleanupPathSafeResult {
  if (typeof path !== "string" || !path.trim()) {
    return { ok: false, error: "Path must be a non-empty string" }
  }
  const normalized = path.trim()
  if (normalized.includes("..")) {
    return { ok: false, error: "Path must not contain .." }
  }
  if (!SAFE_CLEANUP_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: `Path must match envs/<key>/<slug>/tfpilot/requests/<module>_req_<id>.tf; got: ${normalized}`,
    }
  }
  return { ok: true }
}

/** Returns the exact file path to delete for Model 2 cleanup. No marker scanning. */
export function getCleanupPathV2(
  environment_key: string,
  environment_slug: string,
  module: string,
  requestId: string
): string {
  return computeRequestTfPath(environment_key, environment_slug, module, requestId)
}
