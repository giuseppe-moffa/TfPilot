/**
 * Helpers for drift plan v2 dispatch.
 * Payload must include ONLY environment_key and environment_slug (no legacy "environment").
 */

export function buildDriftPlanInputs(env: {
  environment_key: string
  environment_slug: string
}): Record<string, string> {
  return {
    environment_key: env.environment_key,
    environment_slug: env.environment_slug,
  }
}

/** Expected path for drift-plan JSON artifact under ENV_ROOT. */
export function expectedDriftPlanJsonPath(environmentKey: string, environmentSlug: string): string {
  return `envs/${environmentKey}/${environmentSlug}/plan.json`
}
