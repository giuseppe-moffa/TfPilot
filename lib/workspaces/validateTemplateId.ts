/**
 * Validate template_id for workspace/create and deploy flows.
 * Uses workspace-templates-store only (S3 templates/workspaces/). No blank, no static config.
 */

import { getWorkspaceTemplatesIndex } from "@/lib/workspace-templates-store"

export const INVALID_WORKSPACE_TEMPLATE = "INVALID_WORKSPACE_TEMPLATE"
export const WORKSPACE_TEMPLATES_NOT_INITIALIZED = "WORKSPACE_TEMPLATES_NOT_INITIALIZED"

function throwInvalid(): never {
  const err = new Error(INVALID_WORKSPACE_TEMPLATE) as Error & { code?: string }
  err.code = INVALID_WORKSPACE_TEMPLATE
  throw err
}

function throwNotInitialized(): never {
  const err = new Error(WORKSPACE_TEMPLATES_NOT_INITIALIZED) as Error & { code?: string }
  err.code = WORKSPACE_TEMPLATES_NOT_INITIALIZED
  throw err
}

/**
 * Validates template_id against workspace templates index (S3). Throws on invalid.
 * No blank support. orgId is accepted for API compatibility but not used (index is global).
 */
export async function validateTemplateIdOrThrow(
  template_id: string | null | undefined,
  _orgId: string
): Promise<void> {
  if (template_id === null || template_id === undefined) return
  if (typeof template_id !== "string") throwInvalid()
  const s = template_id.trim()
  if (s === "") throwInvalid()
  if (s === "blank") throwInvalid()

  let index: Awaited<ReturnType<typeof getWorkspaceTemplatesIndex>>
  try {
    index = await getWorkspaceTemplatesIndex()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("index not found") || msg.includes("Seed the templates bucket")) {
      throwNotInitialized()
    }
    throw err
  }

  const ids = new Set(index.map((e) => e.id))
  if (!ids.has(s)) throwInvalid()
}

/**
 * Returns true if template_id is valid (in index) or omitted. No blank.
 */
export async function isValidTemplateId(
  template_id: string | null | undefined
): Promise<boolean> {
  if (template_id === null || template_id === undefined) return true
  if (typeof template_id !== "string") return false
  const s = template_id.trim()
  if (s === "" || s === "blank") return false

  try {
    const index = await getWorkspaceTemplatesIndex()
    return index.some((e) => e.id === s)
  } catch {
    return false
  }
}
