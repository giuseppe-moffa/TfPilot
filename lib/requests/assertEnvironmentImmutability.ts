/**
 * Enforces immutability of environment_id, environment_key, environment_slug on request update.
 * Rejects patches that would unset or set empty string for any env field.
 */

export function assertEnvironmentImmutability(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): string | null {
  const patchId = patch.environment_id ?? patch.environmentId
  const patchKey = patch.environment_key ?? patch.environmentKey
  const patchSlug = patch.environment_slug ?? patch.environmentSlug

  if ("environment_id" in patch || "environmentId" in patch) {
    if (patchId === null || patchId === undefined) return "environment_id cannot be unset or set to empty"
    const s = String(patchId).trim()
    if (s === "") return "environment_id cannot be unset or set to empty"
    if (s !== String((current.environment_id ?? "")).trim()) return "environment_id is immutable"
  }
  if ("environment_key" in patch || "environmentKey" in patch) {
    if (patchKey === null || patchKey === undefined) return "environment_key cannot be unset or set to empty"
    const s = String(patchKey).trim()
    if (s === "") return "environment_key cannot be unset or set to empty"
    const curKey = current.environment_key as string | undefined
    if (s !== String(curKey ?? "").trim()) return "environment_key is immutable"
  }
  if ("environment_slug" in patch || "environmentSlug" in patch) {
    if (patchSlug === null || patchSlug === undefined) return "environment_slug cannot be unset or set to empty"
    const s = String(patchSlug).trim()
    if (s === "") return "environment_slug cannot be unset or set to empty"
    const curSlug = current.environment_slug as string | undefined
    if (s !== String(curSlug ?? "").trim()) return "environment_slug is immutable"
  }
  return null
}
