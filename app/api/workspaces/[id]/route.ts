/**
 * GET /api/workspaces/:id — Fetch single workspace + deploy status.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getWorkspaceById } from "@/lib/db/workspaces"
import { getWorkspaceDeployStatus, WORKSPACE_DEPLOY_CHECK_FAILED } from "@/lib/workspaces/getWorkspaceDeployStatus"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
  }

  const ws = await getWorkspaceById(id)
  if (!ws) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    )
  }
  if (ws.org_id !== session.orgId) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    )
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

  if ("error" in deployStatus) {
    return NextResponse.json({
      workspace: ws,
      deployed: false,
      deployPrOpen: null,
      envRootExists: null,
      error: deployStatus.error,
    })
  }

  return NextResponse.json({
    workspace: ws,
    deployed: deployStatus.deployed,
    deployPrOpen: deployStatus.deployPrOpen,
    envRootExists: deployStatus.envRootExists,
    deployPrUrl: deployStatus.deployPrUrl,
  })
}
