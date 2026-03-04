/**
 * Expose environment deploy status for UI consumption.
 * Wraps isEnvironmentDeployed; fail-closed on GitHub lookup failure.
 */

import {
  isEnvironmentDeployed,
  ENV_DEPLOY_CHECK_FAILED,
  type IsEnvironmentDeployedParams,
  type DeployCheckFetcher,
} from "@/lib/environments/isEnvironmentDeployed"

export { ENV_DEPLOY_CHECK_FAILED }

export type EnvironmentForDeployStatus = {
  environment_id: string
  environment_key: string
  environment_slug: string
  repo_full_name: string
}

export type GetEnvironmentDeployStatusResult =
  | { deployed: boolean; deployPrOpen: boolean; envRootExists: boolean; deployPrUrl?: string }
  | { deployed: false; deployPrOpen: null; envRootExists: null; error: typeof ENV_DEPLOY_CHECK_FAILED }

/**
 * Get deploy status for an environment.
 * Reuses isEnvironmentDeployed; fail-closed on lookup failure.
 * @param fetchOverride Optional mock fetcher for tests.
 */
export async function getEnvironmentDeployStatus(
  token: string,
  environment: EnvironmentForDeployStatus,
  fetchOverride?: DeployCheckFetcher
): Promise<GetEnvironmentDeployStatusResult> {
  const params: IsEnvironmentDeployedParams = {
    environment_id: environment.environment_id,
    environment_key: environment.environment_key,
    environment_slug: environment.environment_slug,
    repo_full_name: environment.repo_full_name,
  }

  const result = await isEnvironmentDeployed(token, params, fetchOverride)

  if (!result.ok) {
    return { deployed: false, deployPrOpen: null, envRootExists: null, error: ENV_DEPLOY_CHECK_FAILED }
  }

  return {
    deployed: result.deployed,
    deployPrOpen: result.deployPrOpen,
    envRootExists: result.envRootExists,
    deployPrUrl: result.deployPrUrl,
  }
}
