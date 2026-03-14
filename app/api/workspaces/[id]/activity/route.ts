/**
 * GET /api/workspaces/:id/activity — Workspace activity timeline.
 *
 * Returns derived events from deploy status + request index only (no S3 reads).
 * When GitHub deploy check fails: omit deploy events, include warning WORKSPACE_DEPLOY_CHECK_FAILED.
 * Never throws 500 for GitHub issues; fail-closed and degrade gracefully.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getWorkspaceById } from "@/lib/db/workspaces"
import { getWorkspaceDeployStatus, WORKSPACE_DEPLOY_CHECK_FAILED } from "@/lib/workspaces/getWorkspaceDeployStatus"
import { listRequestIndexRowsByWorkspace } from "@/lib/db/requestsList"
import { buildWorkspaceActivity } from "@/lib/workspaces/activity"

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
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
  }

  const ws = await getWorkspaceById(id)
  if (!ws) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }
  if (ws.org_id !== session.orgId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  const token = await getGitHubAccessToken(req)
  const deployStatus = token
    ? await getWorkspaceDeployStatus(token, {
        workspace_id: ws.workspace_id,
        workspace_key: ws.workspace_key,
        workspace_slug: ws.workspace_slug,
        repo_full_name: ws.repo_full_name,
      })
    : { deployed: false as const, deployPrOpen: null, envRootExists: null, error: WORKSPACE_DEPLOY_CHECK_FAILED }

  const deployCheckFailed = "error" in deployStatus && deployStatus.error === WORKSPACE_DEPLOY_CHECK_FAILED

  const requestRows = await listRequestIndexRowsByWorkspace(
    ws.repo_full_name,
    ws.workspace_key,
    ws.workspace_slug,
    ACTIVITY_REQUEST_LIMIT
  )

  const requests = requestRows ?? []

  const result = buildWorkspaceActivity({
    workspace: {
      workspace_key: ws.workspace_key,
      workspace_slug: ws.workspace_slug,
    },
    deployStatus: {
      deployed: !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployed : false,
      deployPrOpen:
        !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployPrOpen : null,
      deployPrUrl: !deployCheckFailed && !("error" in deployStatus) ? deployStatus.deployPrUrl : undefined,
      deployCheckFailed,
      deployTimestamp: ws.updated_at,
    },
    requests,
  })

  return NextResponse.json({
    activity: result.activity,
    ...(result.warning ? { warning: result.warning } : {}),
  })
}
