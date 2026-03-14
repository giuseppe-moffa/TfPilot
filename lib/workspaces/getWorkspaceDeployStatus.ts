/**
 * Expose workspace deploy status for UI consumption.
 * Wraps isWorkspaceDeployed; fail-closed on GitHub lookup failure.
 */

import {
  isWorkspaceDeployed,
  WORKSPACE_DEPLOY_CHECK_FAILED,
  type IsWorkspaceDeployedParams,
  type DeployCheckFetcher,
} from "@/lib/workspaces/isWorkspaceDeployed"

export { WORKSPACE_DEPLOY_CHECK_FAILED }

export type WorkspaceForDeployStatus = {
  workspace_id: string
  workspace_key: string
  workspace_slug: string
  repo_full_name: string
}

export type GetWorkspaceDeployStatusResult =
  | { deployed: boolean; deployPrOpen: boolean; envRootExists: boolean; deployPrUrl?: string }
  | { deployed: false; deployPrOpen: null; envRootExists: null; error: typeof WORKSPACE_DEPLOY_CHECK_FAILED }

/**
 * Get deploy status for a workspace.
 * @param fetchOverride Optional mock fetcher for tests.
 */
export async function getWorkspaceDeployStatus(
  token: string,
  workspace: WorkspaceForDeployStatus,
  fetchOverride?: DeployCheckFetcher
): Promise<GetWorkspaceDeployStatusResult> {
  const params: IsWorkspaceDeployedParams = {
    workspace_id: workspace.workspace_id,
    workspace_key: workspace.workspace_key,
    workspace_slug: workspace.workspace_slug,
    repo_full_name: workspace.repo_full_name,
  }

  const result = await isWorkspaceDeployed(token, params, fetchOverride)

  if (!result.ok) {
    return { deployed: false, deployPrOpen: null, envRootExists: null, error: WORKSPACE_DEPLOY_CHECK_FAILED }
  }

  return {
    deployed: result.deployed,
    deployPrOpen: result.deployPrOpen,
    envRootExists: result.envRootExists,
    deployPrUrl: result.deployPrUrl,
  }
}
