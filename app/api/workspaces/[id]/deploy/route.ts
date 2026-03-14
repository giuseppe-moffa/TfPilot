/**
 * POST /api/workspaces/:id/deploy — Create deploy PR from workspace template.
 * Creates branch deploy/<key>/<slug>, commits skeleton files, opens PR.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
} from "@/lib/auth/permissions"
import { getProjectByKey } from "@/lib/db/projects"
import { getWorkspaceById, type Workspace } from "@/lib/db/workspaces"
import {
  isWorkspaceDeployed,
  WORKSPACE_DEPLOY_CHECK_FAILED,
  type IsWorkspaceDeployedParams,
  type IsWorkspaceDeployedResult,
} from "@/lib/workspaces/isWorkspaceDeployed"
import { getWorkspaceTemplate } from "@/lib/workspace-templates-store"
import { workspaceSkeleton } from "@/lib/workspaces/workspaceSkeleton"
import { getDeployBranchName } from "@/lib/workspaces/checkDeployBranch"
import {
  createDeployPR,
  DeployBranchExistsError,
  type CreateDeployPRParams,
  type CreateDeployPRResult,
} from "@/lib/github/createDeployPR"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"

export type DeployRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  getGitHubAccessToken: (req?: NextRequest) => Promise<string | null>
  getWorkspaceById: (id: string) => Promise<Workspace | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ id: string; orgId: string; repoFullName?: string; defaultBranch?: string } | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<import("@/lib/auth/permissions").PermissionContext>
  requireProjectPermission: (
    ctx: import("@/lib/auth/permissions").PermissionContext,
    projectId: string,
    permission: "deploy"
  ) => Promise<unknown>
  isWorkspaceDeployed: (
    token: string,
    params: IsWorkspaceDeployedParams
  ) => Promise<IsWorkspaceDeployedResult>
  createDeployPR: (token: string, params: CreateDeployPRParams) => Promise<CreateDeployPRResult>
}

const realDeps: DeployRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getGitHubAccessToken,
  getWorkspaceById,
  getProjectByKey,
  buildPermissionContext,
  requireProjectPermission,
  isWorkspaceDeployed,
  createDeployPR,
}

/** Factory for testability; realDeps used in runtime export. */
export function makePOST(deps: DeployRouteDeps) {
  return async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id: workspaceId } = await params
    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id required" }, { status: 400 })
    }

    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    if (!session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes

    const token = await deps.getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
    }

    const wsRow = await deps.getWorkspaceById(workspaceId)
    if (!wsRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (wsRow.org_id !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const project = await deps.getProjectByKey(session.orgId!, wsRow.project_key)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const ctx = await deps.buildPermissionContext(session.login, session.orgId!)
    try {
      await deps.requireProjectPermission(ctx, project.id, "deploy")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Deploy not permitted for your role" }, { status: 403 })
      }
      throw e
    }

    if (wsRow.archived_at) {
      return NextResponse.json({ error: "Workspace is archived" }, { status: 409 })
    }

    const repoFullName = project.repoFullName?.trim() ?? ""
    const defaultBranch = project.defaultBranch?.trim() ?? ""
    if (!repoFullName || !defaultBranch) {
      return NextResponse.json(
        {
          error: "Project is missing repo configuration",
          detail: !repoFullName
            ? "repo_full_name is required. Update the project settings."
            : "default_branch is required. Update the project settings.",
        },
        { status: 400 }
      )
    }

    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) {
      return NextResponse.json(
        { error: "Project repo_full_name is invalid (expected owner/repo)" },
        { status: 400 }
      )
    }

    const template_id =
      typeof wsRow.template_id === "string" && wsRow.template_id.trim() !== ""
        ? wsRow.template_id.trim()
        : null
    const template_version =
      typeof wsRow.template_version === "string" && wsRow.template_version.trim() !== ""
        ? wsRow.template_version.trim()
        : null
    const template_inputs =
      wsRow.template_inputs != null &&
      typeof wsRow.template_inputs === "object" &&
      !Array.isArray(wsRow.template_inputs)
        ? wsRow.template_inputs
        : null

    if (!template_id || !template_version) {
      return NextResponse.json(
        {
          error: "Workspace missing template",
          detail:
            "Workspace must have template_id and template_version. Template-only workspaces cannot deploy without a pinned template.",
        },
        { status: 500 }
      )
    }
    if (!template_inputs) {
      return NextResponse.json(
        {
          error: "Workspace missing template_inputs",
          detail: "Workspace must have template_inputs (object).",
        },
        { status: 500 }
      )
    }

    try {
      await getWorkspaceTemplate(template_id, template_version)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        {
          error: "Template document missing",
          detail: `Template document missing for ${template_id}@${template_version}. ${msg}`,
        },
        { status: 500 }
      )
    }

    const checkResult = await deps.isWorkspaceDeployed(token, {
      workspace_id: wsRow.workspace_id,
      workspace_key: wsRow.workspace_key,
      workspace_slug: wsRow.workspace_slug,
      repo_full_name: wsRow.repo_full_name,
    })

    if (!checkResult.ok) {
      return NextResponse.json(
        { error: WORKSPACE_DEPLOY_CHECK_FAILED },
        { status: 503 }
      )
    }

    if (checkResult.deployed) {
      return NextResponse.json(
        { error: "WORKSPACE_ALREADY_DEPLOYED" },
        { status: 409 }
      )
    }

    if (checkResult.deployPrOpen) {
      return NextResponse.json(
        { error: "WORKSPACE_DEPLOY_IN_PROGRESS" },
        { status: 409 }
      )
    }

    const { wsRoot, files } = await workspaceSkeleton({
      workspace_key: wsRow.workspace_key,
      workspace_slug: wsRow.workspace_slug,
      template_id,
      template_version,
      template_inputs,
      project_key: wsRow.project_key,
    })

    const branchName = getDeployBranchName(wsRow.workspace_key, wsRow.workspace_slug)

    const createParams: CreateDeployPRParams = {
      owner,
      repo,
      base: defaultBranch,
      branchName,
      files,
      commitMessage: `chore: deploy workspace ${wsRow.workspace_key}/${wsRow.workspace_slug}`,
      prTitle: `Deploy workspace ${wsRow.workspace_key}/${wsRow.workspace_slug}`,
      prBody: `Workspace deploy for ${wsRow.project_key}/${wsRow.workspace_key}/${wsRow.workspace_slug}.\n\nCreates:\n- ${wsRoot}/backend.tf\n- ${wsRoot}/providers.tf\n- ${wsRoot}/versions.tf\n- ${wsRoot}/tfpilot/base.tf\n- ${wsRoot}/tfpilot/requests/ (request files)`,
    }

    try {
      const result = await deps.createDeployPR(token, createParams)

      writeAuditEvent(auditWriteDeps, {
        org_id: wsRow.org_id,
        actor_login: session.login,
        source: "user",
        event_type: "workspace_deploy_pr_opened",
        entity_type: "workspace",
        entity_id: workspaceId,
        workspace_id: wsRow.workspace_id,
        project_key: wsRow.project_key,
        metadata: { project_key: wsRow.project_key, workspace_slug: wsRow.workspace_slug, pr_number: result.pr_number },
      }).catch(() => {})

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
          { error: "WORKSPACE_DEPLOY_IN_PROGRESS" },
          { status: 409 }
        )
      }
      throw err
    }
  }
}

export const POST = makePOST(realDeps)
