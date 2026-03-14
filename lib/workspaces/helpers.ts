/**
 * Pure domain helpers for Workspaces.
 * Workspace = Terraform root + state boundary.
 */

/** workspace_slug rules: lowercase, alphanumeric+hyphen, starts with letter, max 63, no spaces, no underscores */
const SLUG_REGEX = /^[a-z][a-z0-9-]*$/

export function validateWorkspaceSlug(slug: string): { ok: true } | { ok: false; error: string } {
  if (typeof slug !== "string") {
    return { ok: false, error: "Name must be a string." }
  }
  const s = slug.trim()
  if (!s) {
    return { ok: false, error: "Name is required." }
  }
  if (s !== s.toLowerCase()) {
    return { ok: false, error: "Name must be lowercase only." }
  }
  if (s.includes(" ")) {
    return { ok: false, error: "Name must not contain spaces." }
  }
  if (s.includes("_")) {
    return { ok: false, error: "Name must not contain underscores." }
  }
  if (s.length > 63) {
    return { ok: false, error: "Name must be at most 63 characters." }
  }
  if (!SLUG_REGEX.test(s)) {
    return {
      ok: false,
      error: "Name must start with a letter and contain only lowercase letters, numbers, and hyphens.",
    }
  }
  return { ok: true }
}

/** Returns envs/<workspace_key>/<workspace_slug>. Path convention intentionally kept as envs/. */
export function computeWorkspaceRoot(workspace_key: string, workspace_slug: string): string {
  return `envs/${workspace_key}/${workspace_slug}`
}

export type WorkspaceRefInput = {
  workspace_id?: string
  workspace_key?: string
  workspace_slug?: string
}

export type ResolvedWorkspaceRef = {
  workspace_id: string
  workspace_key: string
  workspace_slug: string
}

export type ResolveWorkspaceRefResult =
  | { ok: true; ref: ResolvedWorkspaceRef }
  | { ok: false; error: string }

/**
 * Validate POST /api/workspaces body. Returns errors or null if valid.
 * Pure, no side effects.
 * Requires template_id (non-empty string). template_version and template_inputs are optional.
 */
export function validateCreateWorkspaceBody(body: {
  project_key?: unknown
  workspace_key?: unknown
  workspace_slug?: unknown
  template_id?: unknown
}): string[] | null {
  const errors: string[] = []
  const project_key = typeof body.project_key === "string" ? body.project_key.trim() : ""
  const workspace_key = typeof body.workspace_key === "string" ? body.workspace_key.trim().toLowerCase() : ""
  const workspace_slug = typeof body.workspace_slug === "string" ? body.workspace_slug.trim() : ""
  const template_id = typeof body.template_id === "string" ? body.template_id.trim() : ""

  if (!project_key) errors.push("project_key is required")
  if (!workspace_key) errors.push("workspace_key is required")
  if (!workspace_slug) errors.push("Name is required")
  if (!template_id) errors.push("template_id is required")
  if (workspace_key && !["dev", "prod"].includes(workspace_key)) {
    errors.push("workspace_key must be dev or prod")
  }
  if (workspace_slug) {
    const slugResult = validateWorkspaceSlug(workspace_slug)
    if (!slugResult.ok) errors.push(slugResult.error)
  }
  return errors.length > 0 ? errors : null
}

/** Lookup signature for resolveWorkspaceRef. Returns key+slug when workspace exists. */
export type WorkspaceLookup = (
  workspace_id: string
) => Promise<{ workspace_key: string; workspace_slug: string } | null>

/**
 * Validates workspace reference input.
 * - Preferred: workspace_id only (caller supplies lookup).
 * - Allowed for create: (workspace_key, workspace_slug) only.
 * - When both workspace_id and (key, slug) provided: MUST match (requires lookup).
 */
export async function resolveWorkspaceRef(
  input: WorkspaceRefInput,
  lookup?: WorkspaceLookup
): Promise<ResolveWorkspaceRefResult> {
  const hasId = typeof input.workspace_id === "string" && input.workspace_id.trim() !== ""
  const hasKeySlug =
    typeof input.workspace_key === "string" &&
    input.workspace_key.trim() !== "" &&
    typeof input.workspace_slug === "string" &&
    input.workspace_slug.trim() !== ""

  if (hasId && hasKeySlug) {
    if (!lookup) {
      return { ok: false, error: "Match validation requires workspace lookup." }
    }
    const ws = await lookup(input.workspace_id!.trim())
    if (!ws) {
      return { ok: false, error: "Workspace not found." }
    }
    if (ws.workspace_key !== input.workspace_key!.trim() || ws.workspace_slug !== input.workspace_slug!.trim()) {
      return {
        ok: false,
        error: "workspace_id does not match (workspace_key, workspace_slug).",
      }
    }
    const slugResult = validateWorkspaceSlug(input.workspace_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    return {
      ok: true,
      ref: {
        workspace_id: input.workspace_id!.trim(),
        workspace_key: ws.workspace_key,
        workspace_slug: ws.workspace_slug,
      },
    }
  }

  if (hasId) {
    if (!lookup) {
      return { ok: false, error: "workspace_id requires lookup to resolve workspace_key and workspace_slug." }
    }
    const ws = await lookup(input.workspace_id!.trim())
    if (!ws) {
      return { ok: false, error: "Workspace not found." }
    }
    return {
      ok: true,
      ref: {
        workspace_id: input.workspace_id!.trim(),
        workspace_key: ws.workspace_key,
        workspace_slug: ws.workspace_slug,
      },
    }
  }

  if (hasKeySlug) {
    const slugResult = validateWorkspaceSlug(input.workspace_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    return {
      ok: true,
      ref: {
        workspace_id: "",
        workspace_key: input.workspace_key!.trim(),
        workspace_slug: input.workspace_slug!.trim(),
      },
    }
  }

  return { ok: false, error: "Provide workspace_id or (workspace_key, workspace_slug)." }
}
