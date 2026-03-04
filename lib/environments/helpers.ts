/**
 * Pure domain helpers for Model 2 Environments.
 * Phase 0 scaffolding. No side effects. Not wired into routes.
 */

/** environment_slug rules per ARCHITECTURE_DELTA_ENVIRONMENTS §3.1: lowercase, alphanumeric+hyphen, starts with letter, max 63, no spaces, no underscores */
const SLUG_REGEX = /^[a-z][a-z0-9-]*$/

export function validateEnvironmentSlug(slug: string): { ok: true } | { ok: false; error: string } {
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

/** Returns envs/<environment_key>/<environment_slug> per ARCHITECTURE_DELTA_ENVIRONMENTS. */
export function computeEnvRoot(environment_key: string, environment_slug: string): string {
  return `envs/${environment_key}/${environment_slug}`
}

export type EnvironmentRefInput = {
  environment_id?: string
  environment_key?: string
  environment_slug?: string
}

export type ResolvedEnvironmentRef = {
  environment_id: string
  environment_key: string
  environment_slug: string
}

export type ResolveEnvironmentRefResult =
  | { ok: true; ref: ResolvedEnvironmentRef }
  | { ok: false; error: string }

/**
 * Validate POST /api/environments body. Returns errors or null if valid.
 * Pure, no side effects.
 */
export function validateCreateEnvironmentBody(body: {
  project_key?: unknown
  environment_key?: unknown
  environment_slug?: unknown
}): string[] | null {
  const errors: string[] = []
  const project_key = typeof body.project_key === "string" ? body.project_key.trim() : ""
  const environment_key = typeof body.environment_key === "string" ? body.environment_key.trim().toLowerCase() : ""
  const environment_slug = typeof body.environment_slug === "string" ? body.environment_slug.trim() : ""

  if (!project_key) errors.push("project_key is required")
  if (!environment_key) errors.push("environment_key is required")
  if (!environment_slug) errors.push("Name is required")
  if (environment_key && !["dev", "prod"].includes(environment_key)) {
    errors.push("environment_key must be dev or prod")
  }
  if (environment_slug) {
    const slugResult = validateEnvironmentSlug(environment_slug)
    if (!slugResult.ok) errors.push(slugResult.error)
  }
  return errors.length > 0 ? errors : null
}

/** Lookup signature for resolveEnvironmentRef. Returns key+slug when env exists. */
export type EnvironmentLookup = (
  environment_id: string
) => Promise<{ environment_key: string; environment_slug: string } | null>

/**
 * Validates environment reference input.
 * - Preferred: environment_id only (caller supplies lookup).
 * - Allowed for create: (environment_key, environment_slug) only.
 * - When both environment_id and (key, slug) provided: MUST match (requires lookup).
 */
export async function resolveEnvironmentRef(
  input: EnvironmentRefInput,
  lookup?: EnvironmentLookup
): Promise<ResolveEnvironmentRefResult> {
  const hasId = typeof input.environment_id === "string" && input.environment_id.trim() !== ""
  const hasKeySlug =
    typeof input.environment_key === "string" &&
    input.environment_key.trim() !== "" &&
    typeof input.environment_slug === "string" &&
    input.environment_slug.trim() !== ""

  if (hasId && hasKeySlug) {
    if (!lookup) {
      return { ok: false, error: "Match validation requires environment lookup." }
    }
    const env = await lookup(input.environment_id!.trim())
    if (!env) {
      return { ok: false, error: "Environment not found." }
    }
    if (env.environment_key !== input.environment_key!.trim() || env.environment_slug !== input.environment_slug!.trim()) {
      return {
        ok: false,
        error: "environment_id does not match (environment_key, environment_slug).",
      }
    }
    const slugResult = validateEnvironmentSlug(input.environment_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    return {
      ok: true,
      ref: {
        environment_id: input.environment_id!.trim(),
        environment_key: env.environment_key,
        environment_slug: env.environment_slug,
      },
    }
  }

  if (hasId) {
    if (!lookup) {
      return { ok: false, error: "environment_id requires lookup to resolve environment_key and environment_slug." }
    }
    const env = await lookup(input.environment_id!.trim())
    if (!env) {
      return { ok: false, error: "Environment not found." }
    }
    return {
      ok: true,
      ref: {
        environment_id: input.environment_id!.trim(),
        environment_key: env.environment_key,
        environment_slug: env.environment_slug,
      },
    }
  }

  if (hasKeySlug) {
    const slugResult = validateEnvironmentSlug(input.environment_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    return {
      ok: true,
      ref: {
        environment_id: "",
        environment_key: input.environment_key!.trim(),
        environment_slug: input.environment_slug!.trim(),
      },
    }
  }

  return { ok: false, error: "Provide environment_id or (environment_key, environment_slug)." }
}
