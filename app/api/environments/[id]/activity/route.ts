/**
 * GET /api/environments/:id/activity — Environment activity timeline.
 *
 * Returns derived events from deploy status + request index only (no S3 reads).
 * When GitHub deploy check fails: omit deploy events, include warning ENV_DEPLOY_CHECK_FAILED.
 * Never throws 500 for GitHub issues; fail-closed and degrade gracefully.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getEnvironmentById } from "@/lib/db/environments"
import { getEnvironmentDeployStatus, ENV_DEPLOY_CHECK_FAILED } from "@/lib/environments/getEnvironmentDeployStatus"
import { listRequestIndexRowsByEnvironment } from "@/lib/db/requestsList"
import { buildEnvironmentActivity } from "@/lib/environments/activity"

const ACTIVITY_REQUEST_LIMIT = 50

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "environment_id required" }, { status: 400 })
  }

  const env = await getEnvironmentById(id)
  if (!env) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }
  if (env.org_id !== session.orgId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  // Deploy status: fail-closed on GitHub auth failure
  const token = await getGitHubAccessToken(req)
  const deployStatus = token
    ? await getEnvironmentDeployStatus(token, {
        environment_id: env.environment_id,
        environment_key: env.environment_key,
        environment_slug: env.environment_slug,
        repo_full_name: env.repo_full_name,
      })
    : { deployed: false as const, deployPrOpen: null, envRootExists: null, error: ENV_DEPLOY_CHECK_FAILED }

  const deployCheckFailed = "error" in deployStatus && deployStatus.error === ENV_DEPLOY_CHECK_FAILED

  // Requests from Postgres: filter by (repo, environment_key, environment_slug).
  const requestRows = await listRequestIndexRowsByEnvironment(
    env.repo_full_name,
    env.environment_key,
    env.environment_slug,
    ACTIVITY_REQUEST_LIMIT
  )

  const requests = requestRows ?? []

  const result = buildEnvironmentActivity({
    env: {
      environment_key: env.environment_key,
      environment_slug: env.environment_slug,
    },
    deployStatus: {
      deployed: !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployed : false,
      deployPrOpen:
        !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployPrOpen : null,
      deployPrUrl: !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployPrUrl : undefined,
      deployCheckFailed,
      deployTimestamp: env.updated_at,
    },
    requests,
  })

  return NextResponse.json({
    activity: result.activity,
    ...(result.warning ? { warning: result.warning } : {}),
  })
}
