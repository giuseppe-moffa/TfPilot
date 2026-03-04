/**
 * Resolve environment reference for request create.
 * Model 2 only — environment_id or (project_key, environment_key, environment_slug). No legacy.
 */

import {
  getEnvironmentById,
  getEnvironmentByRepoKeySlug,
  type Environment,
} from "@/lib/db/environments"
import { resolveInfraRepo } from "@/config/infra-repos"
import { validateEnvironmentSlug } from "@/lib/environments/helpers"
import { computeEnvRoot } from "@/lib/environments/helpers"

export type CreateEnvironmentInput =
  | { environment_id: string }
  | { project_key: string; environment_key: string; environment_slug: string }

export type ResolvedRequestEnvironment = {
  project_key: string
  environment_key: string
  environment_slug: string
  environment_id?: string
  targetRepo: { owner: string; repo: string; base: string; envPath: string }
}

export type ResolveRequestEnvironmentResult =
  | { ok: true; resolved: ResolvedRequestEnvironment }
  | { ok: false; error: string }

export type ResolveRequestEnvironmentDeps = {
  getEnvironmentById: (id: string) => Promise<Environment | null>
  getEnvironmentByRepoKeySlug: (p: {
    repo_full_name: string
    environment_key: string
    environment_slug: string
  }) => Promise<Environment | null>
}

/**
 * Resolves environment for request create. Execution remains Model 1 (targetRepo.envPath).
 * - environment_id: lookup env, reject archived.
 * - (project_key, environment_key, environment_slug): lookup by repo+key+slug, reject if not found or archived.
 * - (project, environment): legacy; no env lookup, use resolveInfraRepo.
 * - When both environment_id and key+slug: must match.
 * Pass deps for testing (mock DB).
 */
export async function resolveRequestEnvironment(input: {
  environment_id?: string
  project_key?: string
  environment_key?: string
  environment_slug?: string
  _deps?: ResolveRequestEnvironmentDeps
}): Promise<ResolveRequestEnvironmentResult> {
  const deps = input._deps
  const getById = deps?.getEnvironmentById ?? getEnvironmentById
  const getByKeySlug = deps?.getEnvironmentByRepoKeySlug ?? getEnvironmentByRepoKeySlug

  const hasId = typeof input.environment_id === "string" && input.environment_id.trim() !== ""
  const hasKeySlug =
    typeof input.project_key === "string" &&
    input.project_key.trim() !== "" &&
    typeof input.environment_key === "string" &&
    input.environment_key.trim() !== "" &&
    typeof input.environment_slug === "string" &&
    input.environment_slug.trim() !== ""
  if (hasId) {
    const env = await getById(input.environment_id!.trim())
    if (!env) {
      return { ok: false, error: "Environment not found" }
    }
    if (env.archived_at) {
      return { ok: false, error: "Environment is archived" }
    }
    if (hasKeySlug) {
      const pk = input.project_key!.trim()
      const ek = input.environment_key!.trim()
      const es = input.environment_slug!.trim()
      if (env.project_key !== pk || env.environment_key !== ek || env.environment_slug !== es) {
        return { ok: false, error: "environment_id does not match (project_key, environment_key, environment_slug)" }
      }
    }
    return buildResolved(env, env.project_key)
  }

  if (hasKeySlug) {
    const slugResult = validateEnvironmentSlug(input.environment_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    const targetRepo = resolveInfraRepo(input.project_key!.trim(), input.environment_key!.trim())
    if (!targetRepo) {
      return { ok: false, error: "No infra repo configured for project_key/environment_key" }
    }
    const repoFullName = `${targetRepo.owner}/${targetRepo.repo}`
    const env = await getByKeySlug({
      repo_full_name: repoFullName,
      environment_key: input.environment_key!.trim(),
      environment_slug: input.environment_slug!.trim(),
    })
    if (!env) {
      return { ok: false, error: "Environment not found" }
    }
    if (env.archived_at) {
      return { ok: false, error: "Environment is archived" }
    }
    return buildResolved(env, input.project_key!.trim())
  }

  return {
    ok: false,
    error:
      "Provide environment_id, or (project_key, environment_key, environment_slug)",
  }
}

async function buildResolved(
  env: Environment,
  project_key: string
): Promise<ResolveRequestEnvironmentResult> {
  const targetRepo = resolveInfraRepo(project_key, env.environment_key)
  if (!targetRepo) {
    return { ok: false, error: "No infra repo configured for project_key/environment_key" }
  }
  const envPath = computeEnvRoot(env.environment_key, env.environment_slug)
  return {
    ok: true,
    resolved: {
      project_key: env.project_key,
      environment_key: env.environment_key,
      environment_slug: env.environment_slug,
      environment_id: env.environment_id,
      targetRepo: {
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        base: targetRepo.base,
        envPath,
      },
    },
  }
}
