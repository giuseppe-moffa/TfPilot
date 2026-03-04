/**
 * Helpers for environment destroy dispatch (destroy_scope="environment").
 * environment_id is passed so webhook can derive correlation when index misses (facts-only).
 */

export function buildEnvDestroyInputs(env: {
  environment_key: string
  environment_slug: string
  environment_id?: string
}): Record<string, string> {
  const inputs: Record<string, string> = {
    environment_key: env.environment_key,
    environment_slug: env.environment_slug,
    destroy_scope: "environment",
  }
  if (env.environment_id) inputs.environment_id = env.environment_id
  return inputs
}
