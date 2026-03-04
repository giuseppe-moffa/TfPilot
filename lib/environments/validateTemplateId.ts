/**
 * Validate template_id for POST /api/environments.
 * Per ENVIRONMENT_TEMPLATES_DELTA §8.
 */

import { environmentTemplates } from "@/config/environment-templates"

const VALID_IDS = new Set([
  "blank",
  ...environmentTemplates.map((t) => t.id),
])

/**
 * Returns true if template_id is valid or omitted.
 * Valid: null, undefined, or one of: blank, baseline-ai-service, baseline-app-service, baseline-worker-service.
 * Invalid: empty string "", unknown ids.
 */
export function isValidTemplateId(template_id: string | null | undefined): boolean {
  if (template_id === null || template_id === undefined) return true
  if (typeof template_id !== "string") return false
  const s = template_id.trim()
  if (s === "") return false // Empty string is invalid per contract
  return VALID_IDS.has(s)
}
