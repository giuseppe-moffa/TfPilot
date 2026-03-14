/**
 * Workspace deploy validation — GitHub state checks.
 * Fail-closed: if lookup fails, return WORKSPACE_DEPLOY_CHECK_FAILED.
 */

import { parseRepoFullName } from "@/lib/github/repo"
import { ghResponse } from "@/lib/github/client"
import { computeWorkspaceRoot } from "@/lib/workspaces/helpers"
import { getDeployBranchName } from "@/lib/workspaces/checkDeployBranch"

export const WORKSPACE_DEPLOY_CHECK_FAILED = "WORKSPACE_DEPLOY_CHECK_FAILED"

export type IsWorkspaceDeployedParams = {
  workspace_id: string
  workspace_key: string
  workspace_slug: string
  repo_full_name: string
}

export type IsWorkspaceDeployedResult =
  | { ok: true; deployed: boolean; deployPrOpen: boolean; envRootExists: boolean; deployPrUrl?: string }
  | { ok: false; error: typeof WORKSPACE_DEPLOY_CHECK_FAILED }

/** Optional fetch override for testing. */
export type DeployCheckFetcher = (path: string) => Promise<Response>

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

async function runCheck(
  token: string,
  params: IsWorkspaceDeployedParams,
  fetchOverride?: DeployCheckFetcher
): Promise<IsWorkspaceDeployedResult> {
  const parsed = parseRepoFullName(params.repo_full_name)
  if (!parsed) {
    return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
  }
  const { owner, repo } = parsed
  const wsRoot = computeWorkspaceRoot(params.workspace_key, params.workspace_slug)
  const backendPath = `${wsRoot}/backend.tf`
  const deployBranch = getDeployBranchName(params.workspace_key, params.workspace_slug)

  const fetchPath = fetchOverride ?? ((path: string) => ghResponse(token, path))

  try {
    const repoRes = await fetchPath(`/repos/${owner}/${repo}`)
    if (!isSuccessStatus(repoRes.status)) {
      return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
    }
    const repoJson = (await repoRes.json()) as { default_branch?: string }
    const defaultBranch = repoJson.default_branch ?? "main"

    const backendRes = await fetchPath(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(backendPath)}?ref=${encodeURIComponent(defaultBranch)}`
    )
    const rootRes = await fetchPath(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(wsRoot)}?ref=${encodeURIComponent(defaultBranch)}`
    )
    const prRes = await fetchPath(
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(owner + ":" + deployBranch)}`
    )

    if (!isSuccessStatus(prRes.status)) {
      return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
    }

    const deployed = isSuccessStatus(backendRes.status)
    const envRootExists = isSuccessStatus(rootRes.status)
    const prs = (await prRes.json()) as Array<{ html_url?: string }>
    const deployPrOpen = Array.isArray(prs) && prs.length > 0
    const deployPrUrl = deployPrOpen && prs[0]?.html_url ? prs[0].html_url : undefined

    if (!isSuccessStatus(backendRes.status) && backendRes.status !== 404) {
      return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
    }
    if (!isSuccessStatus(rootRes.status) && rootRes.status !== 404) {
      return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
    }

    return {
      ok: true,
      deployed,
      deployPrOpen,
      envRootExists,
      deployPrUrl,
    }
  } catch {
    return { ok: false, error: WORKSPACE_DEPLOY_CHECK_FAILED }
  }
}

/**
 * Check workspace deploy state via GitHub API.
 * Fail-closed on any API error, rate limit, or auth failure.
 */
export async function isWorkspaceDeployed(
  token: string,
  params: IsWorkspaceDeployedParams,
  fetchOverride?: DeployCheckFetcher
): Promise<IsWorkspaceDeployedResult> {
  return runCheck(token, params, fetchOverride)
}
