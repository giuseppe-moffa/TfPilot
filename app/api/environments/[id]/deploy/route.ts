/**
 * POST /api/environments/:id/deploy — Create deploy PR from environment template.
 * Creates branch deploy/<key>/<slug>, commits skeleton files, opens PR.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getUserRole } from "@/lib/auth/roles"
import type { UserRole } from "@/lib/auth/roles"
import { getEnvironmentById, type Environment } from "@/lib/db/environments"
import { resolveInfraRepoByProjectAndEnvKey } from "@/config/infra-repos"
import {
  isEnvironmentDeployed,
  ENV_DEPLOY_CHECK_FAILED,
  type IsEnvironmentDeployedParams,
  type IsEnvironmentDeployedResult,
} from "@/lib/environments/isEnvironmentDeployed"
import { isValidTemplateId } from "@/lib/environments/validateTemplateId"
import { envSkeleton } from "@/lib/environments/envSkeleton"
import { getDeployBranchName } from "@/lib/environments/checkDeployBranch"
import {
  createDeployPR,
  DeployBranchExistsError,
  type CreateDeployPRParams,
  type CreateDeployPRResult,
} from "@/lib/github/createDeployPR"

export type DeployRouteDeps = {
  getSessionFromCookies: () => Promise<{ login: string; accessToken?: string | null } | null>
  getUserRole: (login?: string | null) => UserRole
  getGitHubAccessToken: (req?: NextRequest) => Promise<string | null>
  getEnvironmentById: (id: string) => Promise<Environment | null>
  isEnvironmentDeployed: (
    token: string,
    params: IsEnvironmentDeployedParams
  ) => Promise<IsEnvironmentDeployedResult>
  createDeployPR: (token: string, params: CreateDeployPRParams) => Promise<CreateDeployPRResult>
}

const realDeps: DeployRouteDeps = {
  getSessionFromCookies,
  getUserRole,
  getGitHubAccessToken,
  getEnvironmentById,
  isEnvironmentDeployed,
  createDeployPR,
}

/** Factory for testability; realDeps used in runtime export. */
export function makePOST(deps: DeployRouteDeps) {
  return async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id: environmentId } = await params
    if (!environmentId) {
      return NextResponse.json({ error: "environment_id required" }, { status: 400 })
    }

    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    const role = deps.getUserRole(session.login)
    if (role !== "admin") {
      return NextResponse.json({ error: "Deploy not permitted for your role" }, { status: 403 })
    }

    const token = await deps.getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const envRow = await deps.getEnvironmentById(environmentId)
    if (!envRow) {
      return NextResponse.json({ error: "Environment not found" }, { status: 404 })
    }

    if (envRow.archived_at) {
      return NextResponse.json({ error: "Environment is archived" }, { status: 409 })
    }

    const infra = resolveInfraRepoByProjectAndEnvKey(envRow.project_key, envRow.environment_key)
    if (!infra) {
      return NextResponse.json(
        { error: "No infra repo configured for project_key + environment_key" },
        { status: 404 }
      )
    }

    const template_id = envRow.template_id ?? "blank"
    if (!isValidTemplateId(template_id)) {
      return NextResponse.json({ error: "INVALID_ENV_TEMPLATE" }, { status: 400 })
    }

    const checkResult = await deps.isEnvironmentDeployed(token, {
      environment_id: envRow.environment_id,
      environment_key: envRow.environment_key,
      environment_slug: envRow.environment_slug,
      repo_full_name: envRow.repo_full_name,
    })

    if (!checkResult.ok) {
      return NextResponse.json(
        { error: ENV_DEPLOY_CHECK_FAILED },
        { status: 503 }
      )
    }

    if (checkResult.deployed) {
      return NextResponse.json(
        { error: "ENV_ALREADY_DEPLOYED" },
        { status: 409 }
      )
    }

    if (checkResult.deployPrOpen) {
      return NextResponse.json(
        { error: "ENV_DEPLOY_IN_PROGRESS" },
        { status: 409 }
      )
    }

    const { envRoot, files } = envSkeleton({
      environment_key: envRow.environment_key,
      environment_slug: envRow.environment_slug,
      template_id,
      project_key: envRow.project_key,
    })

    const branchName = getDeployBranchName(envRow.environment_key, envRow.environment_slug)

    const createParams: CreateDeployPRParams = {
      owner: infra.owner,
      repo: infra.repo,
      base: infra.base,
      branchName,
      files,
      commitMessage: `chore: deploy env ${envRow.environment_key}/${envRow.environment_slug}`,
      prTitle: `Deploy environment ${envRow.environment_key}/${envRow.environment_slug}`,
      prBody: `Environment deploy for ${envRow.project_key}/${envRow.environment_key}/${envRow.environment_slug}.\n\nCreates:\n- ${envRoot}/backend.tf\n- ${envRoot}/providers.tf\n- ${envRoot}/versions.tf\n- ${envRoot}/tfpilot/base.tf\n- ${envRoot}/tfpilot/requests/ (request files)`,
    }

    try {
      const result = await deps.createDeployPR(token, createParams)

      return NextResponse.json(
        {
          deploy: {
            pr_number: result.pr_number,
            pr_url: result.pr_url,
            branch_name: result.branch_name,
            commit_sha: result.commit_sha,
          },
        },
        { status: 201 }
      )
    } catch (err) {
      if (err instanceof DeployBranchExistsError) {
        return NextResponse.json(
          { error: "ENV_DEPLOY_IN_PROGRESS" },
          { status: 409 }
        )
      }
      throw err
    }
  }
}

export const POST = makePOST(realDeps)
