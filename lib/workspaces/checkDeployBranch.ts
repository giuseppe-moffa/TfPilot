/**
 * Deploy branch helpers for workspace deploy validation.
 * Branch naming: deploy/<workspace_key>/<workspace_slug>
 */

export function getDeployBranchName(workspace_key: string, workspace_slug: string): string {
  return `deploy/${workspace_key}/${workspace_slug}`
}
