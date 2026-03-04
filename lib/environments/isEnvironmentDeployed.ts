/**
 * Environment deploy validation — GitHub state checks.
 * Fail-closed: if lookup fails, return ENV_DEPLOY_CHECK_FAILED.
 */

import { parseRepoFullName } from "@/lib/github/repo"
import { ghResponse } from "@/lib/github/client"
import { computeEnvRoot } from "@/lib/environments/helpers"
import { getDeployBranchName } from "@/lib/environments/checkDeployBranch"

export const ENV_DEPLOY_CHECK_FAILED = "ENV_DEPLOY_CHECK_FAILED"

export type IsEnvironmentDeployedParams = {
  environment_id: string
  environment_key: string
  environment_slug: string
  repo_full_name: string
}

export type IsEnvironmentDeployedResult =
  | { ok: true; deployed: boolean; deployPrOpen: boolean; envRootExists: boolean; deployPrUrl?: string }
  | { ok: false; error: typeof ENV_DEPLOY_CHECK_FAILED }

/** Optional fetch override for testing. Receives same path as ghResponse. */
export type DeployCheckFetcher = (path: string) => Promise<Response>

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

async function runCheck(
  token: string,
  params: IsEnvironmentDeployedParams,
  fetchOverride?: DeployCheckFetcher
): Promise<IsEnvironmentDeployedResult> {
  const parsed = parseRepoFullName(params.repo_full_name)
  if (!parsed) {
    return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
  }
  const { owner, repo } = parsed
  const envRoot = computeEnvRoot(params.environment_key, params.environment_slug)
  // Deployed = backend.tf exists on default branch (exact file path, NOT directory).
  // Root directory may exist in a partial deploy PR; backend.tf is the canonical signal.
  const backendPath = `${envRoot}/backend.tf`
  const deployBranch = getDeployBranchName(params.environment_key, params.environment_slug)

  const fetchPath = fetchOverride ?? ((path: string) => ghResponse(token, path))

  try {
    const repoRes = await fetchPath(`/repos/${owner}/${repo}`)
    if (!isSuccessStatus(repoRes.status)) {
      return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
    }
    const repoJson = (await repoRes.json()) as { default_branch?: string }
    const defaultBranch = repoJson.default_branch ?? "main"

    const backendRes = await fetchPath(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(backendPath)}?ref=${encodeURIComponent(defaultBranch)}`
    )
    const envRootRes = await fetchPath(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(envRoot)}?ref=${encodeURIComponent(defaultBranch)}`
    )
    // Must filter: state=open + head=deploy/<key>/<slug>. Closed PRs must not block deploy.
    const prRes = await fetchPath(
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(owner + ":" + deployBranch)}`
    )

    if (!isSuccessStatus(prRes.status)) {
      return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
    }

    const deployed = isSuccessStatus(backendRes.status)
    const envRootExists = isSuccessStatus(envRootRes.status)
    const prs = (await prRes.json()) as Array<{ html_url?: string }>
    const deployPrOpen = Array.isArray(prs) && prs.length > 0
    const deployPrUrl = deployPrOpen && prs[0]?.html_url ? prs[0].html_url : undefined

    if (!isSuccessStatus(backendRes.status) && backendRes.status !== 404) {
      return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
    }
    if (!isSuccessStatus(envRootRes.status) && envRootRes.status !== 404) {
      return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
    }

    return {
      ok: true,
      deployed,
      deployPrOpen,
      envRootExists,
      deployPrUrl,
    }
  } catch {
    return { ok: false, error: ENV_DEPLOY_CHECK_FAILED }
  }
}

/**
 * Check environment deploy state via GitHub API.
 * Fail-closed on any API error, rate limit, or auth failure.
 * @param fetchOverride Optional mock fetcher for tests.
 */
export async function isEnvironmentDeployed(
  token: string,
  params: IsEnvironmentDeployedParams,
  fetchOverride?: DeployCheckFetcher
): Promise<IsEnvironmentDeployedResult> {
  return runCheck(token, params, fetchOverride)
}
