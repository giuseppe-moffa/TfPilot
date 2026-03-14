/**
 * Enforces immutability of workspace_id, workspace_key, workspace_slug on request update.
 * Rejects patches that would unset or change any workspace field.
 */

export function assertWorkspaceImmutability(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): string | null {
  const patchId = patch.workspace_id ?? patch.workspaceId
  const patchKey = patch.workspace_key ?? patch.workspaceKey
  const patchSlug = patch.workspace_slug ?? patch.workspaceSlug

  if ("workspace_id" in patch || "workspaceId" in patch) {
    if (patchId === null || patchId === undefined) return "workspace_id cannot be unset or set to empty"
    const s = String(patchId).trim()
    if (s === "") return "workspace_id cannot be unset or set to empty"
    if (s !== String((current.workspace_id ?? "")).trim()) return "workspace_id is immutable"
  }
  if ("workspace_key" in patch || "workspaceKey" in patch) {
    if (patchKey === null || patchKey === undefined) return "workspace_key cannot be unset or set to empty"
    const s = String(patchKey).trim()
    if (s === "") return "workspace_key cannot be unset or set to empty"
    const curKey = current.workspace_key as string | undefined
    if (s !== String(curKey ?? "").trim()) return "workspace_key is immutable"
  }
  if ("workspace_slug" in patch || "workspaceSlug" in patch) {
    if (patchSlug === null || patchSlug === undefined) return "workspace_slug cannot be unset or set to empty"
    const s = String(patchSlug).trim()
    if (s === "") return "workspace_slug cannot be unset or set to empty"
    const curSlug = current.workspace_slug as string | undefined
    if (s !== String(curSlug ?? "").trim()) return "workspace_slug is immutable"
  }
  return null
}
