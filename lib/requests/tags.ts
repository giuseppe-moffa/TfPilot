/**
 * Server-authoritative tags: TfPilot auto-generates required tags on create/update.
 * Tags are not user-configurable in the UI; any incoming tags are treated as optional
 * "extra" and merged with required keys, with required keys taking precedence.
 * Terraform modules receive a single `tags` variable (merge of extra + required).
 */

export const REQUIRED_TAG_KEYS = [
  "tfpilot:request_id",
  "tfpilot:project",
  "tfpilot:environment",
  "tfpilot:created_by",
] as const

const REQUIRED_TAG_KEYS_WITH_TEMPLATE = [...REQUIRED_TAG_KEYS, "tfpilot:template_id"] as const

export type RequestForTags = {
  id: string
  project: string
  environment: string
  templateId?: string
}

/**
 * Builds the required tags map. Required keys overwrite any user-supplied values.
 */
export function buildServerAuthoritativeTags(
  request: RequestForTags,
  createdBy: string
): Record<string, string> {
  const tags: Record<string, string> = {
    "tfpilot:request_id": request.id,
    "tfpilot:project": request.project,
    "tfpilot:environment": request.environment,
    "tfpilot:created_by": createdBy,
  }
  if (request.templateId != null && String(request.templateId).trim() !== "") {
    tags["tfpilot:template_id"] = String(request.templateId).trim()
  }
  return tags
}

/**
 * Injects server-authoritative tags into config. Merges any existing config.tags
 * (treated as extra) with required tags; required keys take precedence.
 */
export function injectServerAuthoritativeTags(
  config: Record<string, unknown>,
  request: RequestForTags,
  createdBy: string
): void {
  const extra =
    config.tags && typeof config.tags === "object" && !Array.isArray(config.tags)
      ? (config.tags as Record<string, string>)
      : {}
  const required = buildServerAuthoritativeTags(request, createdBy)
  config.tags = { ...extra, ...required }
}

/**
 * Asserts that all required tag keys are present in config.tags.
 * Use after injectServerAuthoritativeTags to guardrail stored/rendered config.
 */
export function assertRequiredTagsPresent(
  config: Record<string, unknown>,
  request: RequestForTags
): void {
  const tags = config.tags
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    throw new Error("config.tags must be an object with required server-authoritative keys")
  }
  const tagMap = tags as Record<string, unknown>
  const required = request.templateId != null ? REQUIRED_TAG_KEYS_WITH_TEMPLATE : REQUIRED_TAG_KEYS
  for (const key of required) {
    if (key === "tfpilot:template_id") continue
    if (tagMap[key] === undefined || tagMap[key] === null || String(tagMap[key]).trim() === "") {
      throw new Error(`Missing required tag: ${key}`)
    }
  }
  if (request.templateId != null && (tagMap["tfpilot:template_id"] == null || String(tagMap["tfpilot:template_id"]).trim() === "")) {
    throw new Error("Missing required tag: tfpilot:template_id")
  }
}
