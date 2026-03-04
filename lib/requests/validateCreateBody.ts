/**
 * Request create body validation. Extract for testability.
 * Accepts: environment_id | (project_key, environment_key, environment_slug) | (project, environment)
 */

export type CreateBodyInput = {
  environment_id?: string
  project_key?: string
  environment_key?: string
  environment_slug?: string
  project?: string
  environment?: string
  module?: string
  config?: unknown
}

export function validateCreateBody(body: CreateBodyInput): string[] {
  const errors: string[] = []

  const hasEnvId = typeof body.environment_id === "string" && body.environment_id.trim() !== ""
  const hasKeySlug =
    typeof body.project_key === "string" &&
    body.project_key.trim() !== "" &&
    typeof body.environment_key === "string" &&
    body.environment_key.trim() !== "" &&
    typeof body.environment_slug === "string" &&
    body.environment_slug.trim() !== ""

  if (!hasEnvId && !hasKeySlug) {
    errors.push("Provide environment_id or (project_key, environment_key, environment_slug)")
  }

  if (!body.module || typeof body.module !== "string") {
    errors.push("module is required and must be a string")
  }
  if (
    body.config === undefined ||
    body.config === null ||
    typeof body.config !== "object" ||
    Array.isArray(body.config)
  ) {
    errors.push("config is required and must be an object")
  }

  return errors
}
