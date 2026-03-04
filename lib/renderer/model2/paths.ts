/**
 * Model 2 request path utilities.
 * Staged for Phase 3 cutover — not used by request routes until atomic flip.
 * Output: envs/<environment_key>/<environment_slug>/tfpilot/requests/<module>_req_<request_id>.tf
 * Module must be slug-safe [a-z0-9-].
 */

/** Canonical module source depth for Model 2. From tfpilot/requests/ up to repo root, then modules/<module>. */
export const MODULE_SOURCE_PREFIX = "../../../modules/"

/** Returns envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf per delta §6.1. */
export function computeRequestTfPath(
  environment_key: string,
  environment_slug: string,
  module: string,
  requestId: string
): string {
  const envRoot = `envs/${environment_key}/${environment_slug}`
  return `${envRoot}/tfpilot/requests/${module}_req_${requestId}.tf`
}

/** Locked module source string: ../../../modules/<module>. Prevents accidental depth drift. */
export function getModuleSource(module: string): string {
  return `${MODULE_SOURCE_PREFIX}${module}`
}
