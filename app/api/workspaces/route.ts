/**
 * GET /api/workspaces — List workspaces (DB-backed).
 * POST /api/workspaces — Create workspace + bootstrap PR.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { getGitHubAccessToken } from "@/lib/github/auth"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
} from "@/lib/auth/permissions"
import { getProjectByKey } from "@/lib/db/projects"
import {
  listWorkspaces,
  createWorkspace,
  getWorkspaceByRepoKeySlug,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/workspaces"
import { validateCreateWorkspaceBody } from "@/lib/workspaces/helpers"
import {
  getWorkspaceTemplatesIndex,
  getWorkspaceTemplate,
} from "@/lib/workspace-templates-store"
import { resolveTemplateInputs } from "@/lib/workspace-templates/inputs"
import { createBootstrapPr } from "@/lib/github/bootstrapPr"
import { logInfo } from "@/lib/observability/logger"
import { incrementEnvMetric } from "@/lib/observability/metrics"

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const project_key = req.nextUrl.searchParams.get("project_key") ?? undefined
  const include_archived = req.nextUrl.searchParams.get("include_archived") === "true"

  const rows = await listWorkspaces({ orgId: session.orgId, project_key, include_archived })
  if (rows === null) {
    return NextResponse.json(
      { error: "Database not configured or unavailable" },
      { status: 503 }
    )
  }

  return NextResponse.json({ workspaces: rows })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }
  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const token = await getGitHubAccessToken(req)
  if (!token) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
  }

  let body: {
    project_key?: string
    workspace_key?: string
    workspace_slug?: string
    template_id?: string
    template_version?: string
    template_inputs?: Record<string, unknown>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const errors = validateCreateWorkspaceBody(body)
  if (errors) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 400 })
  }

  const template_id = (typeof body.template_id === "string" ? body.template_id : "").trim()
  if (!template_id) {
    return NextResponse.json({ error: "template_id is required" }, { status: 400 })
  }

  let index
  try {
    index = await getWorkspaceTemplatesIndex()
  } catch (err) {
    console.error("[workspaces] template index error:", err)
    return NextResponse.json(
      {
        error: "Workspace templates index not available. Seed the templates bucket before use.",
      },
      { status: 503 }
    )
  }

  const entry = index.find((e) => e.id === template_id)
  if (!entry) {
    return NextResponse.json(
      { error: "Unknown template", detail: `Template '${template_id}' not found in index.` },
      { status: 400 }
    )
  }

  const versionFromUser =
    typeof body.template_version === "string" && body.template_version.trim() !== ""
  const template_version = versionFromUser
    ? body.template_version!.trim()
    : entry.latest_version

  let template
  try {
    template = await getWorkspaceTemplate(template_id, template_version)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isNotFound = msg.includes("not found") || msg.includes("NoSuchKey")
    if (isNotFound && !versionFromUser) {
      return NextResponse.json(
        {
          error: "Template document missing",
          detail: `Template document missing for ${template_id}@${template_version}. Index references this version but the document is not in S3.`,
        },
        { status: 500 }
      )
    }
    if (isNotFound) {
      return NextResponse.json(
        { error: "Unknown template version", detail: `Version '${template_version}' not found for template '${template_id}'.` },
        { status: 400 }
      )
    }
    console.error("[workspaces] template load error:", err)
    return NextResponse.json(
      { error: "Failed to load template", detail: msg },
      { status: 400 }
    )
  }

  let resolvedInputs: Record<string, unknown>
  try {
    resolvedInputs = resolveTemplateInputs(template, body.template_inputs)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: "Invalid template inputs", detail: msg },
      { status: 400 }
    )
  }

  const project_key = (typeof body.project_key === "string" ? body.project_key : "").trim()
  const workspace_key = (typeof body.workspace_key === "string" ? body.workspace_key : "")
    .trim()
    .toLowerCase()
  const workspace_slug = (typeof body.workspace_slug === "string" ? body.workspace_slug : "").trim()

  const project = await getProjectByKey(session.orgId!, project_key)
  if (!project || project.orgId !== session.orgId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }
  const ctx = await buildPermissionContext(session.login, session.orgId!)
  try {
    await requireProjectPermission(ctx, project.id, "deploy")
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Create not permitted for your role" }, { status: 403 })
    }
    throw e
  }

  const repo_full_name = project.repoFullName?.trim() ?? ""
  const default_branch = project.defaultBranch?.trim() ?? ""
  if (!repo_full_name || !default_branch) {
    return NextResponse.json(
      {
        error: "Project is missing repo configuration",
        detail: !repo_full_name
          ? "repo_full_name is required. Update the project settings."
          : "default_branch is required. Update the project settings.",
      },
      { status: 400 }
    )
  }

  const [owner, repo] = repo_full_name.split("/")
  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Project repo_full_name is invalid (expected owner/repo)" },
      { status: 400 }
    )
  }

  let ws
  try {
    ws = await createWorkspace({
      orgId: session.orgId,
      project_key,
      repo_full_name,
      workspace_key,
      workspace_slug,
      template_id,
      template_version,
      template_inputs: resolvedInputs,
    })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e?.code === PG_UNIQUE_VIOLATION) {
      const existing = await getWorkspaceByRepoKeySlug({
        repo_full_name,
        workspace_key,
        workspace_slug,
      })
      return NextResponse.json(
        {
          error: "Workspace already exists",
          workspace_id: existing?.workspace_id,
        },
        { status: 409 }
      )
    }
    throw err
  }

  if (!ws) {
    return NextResponse.json(
      { error: "Database not configured or unavailable" },
      { status: 503 }
    )
  }

  logInfo("workspace.create", {
    workspace_id: ws.workspace_id,
    project_key: ws.project_key,
    workspace_key: ws.workspace_key,
    workspace_slug: ws.workspace_slug,
  })
  incrementEnvMetric("env.create", { env_id: ws.workspace_id })

  const bootstrapResult = await createBootstrapPr(token, {
    owner,
    repo,
    base: default_branch,
  }, {
    workspace_id: ws.workspace_id,
    project_key,
    workspace_key,
    workspace_slug,
  })

  return NextResponse.json(
    {
      workspace: ws,
      bootstrap: bootstrapResult.alreadyBootstrapped
        ? { already_bootstrapped: true }
        : {
            pr_number: bootstrapResult.prNumber,
            pr_url: bootstrapResult.prUrl,
            branch_name: bootstrapResult.branchName,
            commit_sha: bootstrapResult.commitSha,
          },
    },
    { status: 201 }
  )
}
