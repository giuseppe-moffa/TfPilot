/**
 * GET /api/environments/:id — Fetch single environment + deploy status.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getEnvironmentById } from "@/lib/db/environments"
import { getEnvironmentDeployStatus, ENV_DEPLOY_CHECK_FAILED } from "@/lib/environments/getEnvironmentDeployStatus"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "environment_id required" }, { status: 400 })
  }

  const env = await getEnvironmentById(id)
  if (!env) {
    return NextResponse.json(
      { error: "Environment not found" },
      { status: 404 }
    )
  }

  const token = await getGitHubAccessToken(req)
  const deployStatus = token
    ? await getEnvironmentDeployStatus(token, {
        environment_id: env.environment_id,
        environment_key: env.environment_key,
        environment_slug: env.environment_slug,
        repo_full_name: env.repo_full_name,
      })
    : { deployed: false as const, deployPrOpen: null, envRootExists: null, error: ENV_DEPLOY_CHECK_FAILED }

  if ("error" in deployStatus) {
    return NextResponse.json({
      environment: env,
      deployed: false,
      deployPrOpen: null,
      envRootExists: null,
      error: deployStatus.error,
    })
  }

  return NextResponse.json({
    environment: env,
    deployed: deployStatus.deployed,
    deployPrOpen: deployStatus.deployPrOpen,
    envRootExists: deployStatus.envRootExists,
    deployPrUrl: deployStatus.deployPrUrl,
  })
}
