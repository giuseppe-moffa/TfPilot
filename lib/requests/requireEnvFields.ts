/**
 * Model 2: require environment_id, environment_key, environment_slug on request.
 * Used by destroy route and cleanup dispatch — hard-fail if any missing.
 */

export function getMissingEnvFields(req: Record<string, unknown>): string[] {
  const missing: string[] = []
  if (!req.environment_id) missing.push("environment_id")
  if (!req.environment_key) missing.push("environment_key")
  const slug = req.environment_slug ?? ""
  if (String(slug).trim() === "") missing.push("environment_slug")
  return missing
}

export function requireEnvFieldsForDestroy(req: Record<string, unknown>): void {
  const missing = getMissingEnvFields(req)
  if (missing.length > 0) {
    throw new Error(`Request missing required environment fields: ${missing.join(", ")}`)
  }
}
