/**
 * Request create body validation. Extract for testability.
 * Workspace-first: workspace_id or (project_key, workspace_key, workspace_slug).
 */

export type CreateBodyInput = {
  workspace_id?: string
  workspace_key?: string
  workspace_slug?: string
  project_key?: string
  project?: string
  environment?: string
  module?: string
  config?: unknown
}

export function validateCreateBody(body: CreateBodyInput): string[] {
  const errors: string[] = []

  const wsId = body.workspace_id
  const wsKey = body.workspace_key
  const wsSlug = body.workspace_slug

  const hasId = typeof wsId === "string" && wsId.trim() !== ""
  const hasKeySlug =
    typeof body.project_key === "string" &&
    body.project_key.trim() !== "" &&
    typeof wsKey === "string" &&
    wsKey.trim() !== "" &&
    typeof wsSlug === "string" &&
    wsSlug.trim() !== ""

  if (!hasId && !hasKeySlug) {
    errors.push("Provide workspace_id or (project_key, workspace_key, workspace_slug)")
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
