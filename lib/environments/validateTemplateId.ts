/**
 * Validate template_id for POST /api/environments.
 * Per ENVIRONMENT_TEMPLATES_DELTA §8.
 * Step 7: validateTemplateIdOrThrow resolves from S3; isValidTemplateId kept for legacy/invariant tests.
 */

import {
  envTemplatesIndexExists,
  getEnvTemplatesIndex,
} from "@/lib/env-templates-store"
import { environmentTemplates } from "@/config/environment-templates"

export const INVALID_ENV_TEMPLATE = "INVALID_ENV_TEMPLATE"
export const ENV_TEMPLATES_NOT_INITIALIZED = "ENV_TEMPLATES_NOT_INITIALIZED"

function throwInvalid(): never {
  const err = new Error(INVALID_ENV_TEMPLATE) as Error & { code?: string }
  err.code = INVALID_ENV_TEMPLATE
  throw err
}

function throwNotInitialized(): never {
  const err = new Error(ENV_TEMPLATES_NOT_INITIALIZED) as Error & { code?: string }
  err.code = ENV_TEMPLATES_NOT_INITIALIZED
  throw err
}

/**
 * Validates template_id against S3 index (or built-in "blank"). Throws on invalid.
 * - null, undefined, "blank" → valid (no S3)
 * - empty string / whitespace → INVALID_ENV_TEMPLATE
 * - non-blank + index missing → ENV_TEMPLATES_NOT_INITIALIZED
 * - non-blank + index present but id unknown/disabled → INVALID_ENV_TEMPLATE
 *
 * Non-blank strings are trimmed before validation. Callers should use the same
 * trimmed value for downstream use (e.g. envSkeleton) to keep canonical form.
 *
 * @param orgId - Org id from session; required for S3 lookup.
 */
export async function validateTemplateIdOrThrow(
  template_id: string | null | undefined,
  orgId: string
): Promise<void> {
  if (template_id === null || template_id === undefined) return
  if (typeof template_id !== "string") throwInvalid()
  const s = template_id.trim()
  if (s === "") throwInvalid()
  if (s === "blank") return
  const exists = await envTemplatesIndexExists(orgId)
  if (!exists) throwNotInitialized()
  const index = await getEnvTemplatesIndex(orgId)
  const enabledIds = new Set(
    index.filter((e) => e.enabled).map((e) => e.id)
  )
  if (!enabledIds.has(s)) throwInvalid()
}

const VALID_IDS = new Set([
  "blank",
  ...environmentTemplates.map((t) => t.id),
])

/**
 * Returns true if template_id is valid or omitted.
 * Valid: null, undefined, or one of: blank, baseline-ai-service, baseline-app-service, baseline-worker-service.
 * Invalid: empty string "", unknown ids.
 * @deprecated Use validateTemplateIdOrThrow for create/deploy flows (S3-backed).
 */
export function isValidTemplateId(template_id: string | null | undefined): boolean {
  if (template_id === null || template_id === undefined) return true
  if (typeof template_id !== "string") return false
  const s = template_id.trim()
  if (s === "") return false // Empty string is invalid per contract
  return VALID_IDS.has(s)
}
