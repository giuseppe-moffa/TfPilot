import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { resolveProjectByIdOrKey, updateProject, isValidRepoFullName } from "@/lib/db/projects"
import { listWorkspaces } from "@/lib/db/workspaces"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
} from "@/lib/auth/permissions"
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401

  const session = sessionOr401
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }

  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { projectId } = await params
  if (!projectId?.trim()) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  }

  const project = await resolveProjectByIdOrKey(session.orgId!, projectId)
  if (!project || project.orgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const workspaces = await listWorkspaces({ orgId: session.orgId, project_key: project.projectKey, include_archived: false })

  return NextResponse.json({
    project: {
      id: project.id,
      project_key: project.projectKey,
      name: project.name,
      repo_full_name: project.repoFullName,
      default_branch: project.defaultBranch,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    },
    workspace_count: (workspaces ?? []).length,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401

  const session = sessionOr401
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }

  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  const { projectId } = await params
  if (!projectId?.trim()) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  }

  const project = await resolveProjectByIdOrKey(session.orgId!, projectId)
  if (!project || project.orgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Require project admin role to update
  const ctx = await buildPermissionContext(session.login, session.orgId)
  try {
    await requireProjectPermission(ctx, project.id, "manage_access")
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Project admin role required" }, { status: 403 })
    }
    throw e
  }

  let body: { name?: unknown; repo_full_name?: unknown; default_branch?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const errors: string[] = []
  const updates: { name?: string; repoFullName?: string; defaultBranch?: string } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) errors.push("name cannot be empty")
    else if (name.length > 128) errors.push("name must be 128 characters or fewer")
    else updates.name = name
  }

  if (body.repo_full_name !== undefined) {
    const repo = typeof body.repo_full_name === "string" ? body.repo_full_name.trim() : ""
    if (!repo) errors.push("repo_full_name cannot be empty")
    else if (!isValidRepoFullName(repo)) errors.push("repo_full_name must be in owner/repo format")
    else updates.repoFullName = repo
  }

  if (body.default_branch !== undefined) {
    const branch = typeof body.default_branch === "string" ? body.default_branch.trim() : ""
    if (!branch) errors.push("default_branch cannot be empty")
    else if (branch.length > 255) errors.push("default_branch must be 255 characters or fewer")
    else updates.defaultBranch = branch
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 400 })
  }

  const updated = await updateProject(project.id, updates)
  if (!updated) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }

  return NextResponse.json({
    project: {
      id: updated.id,
      project_key: updated.projectKey,
      name: updated.name,
      repo_full_name: updated.repoFullName,
      default_branch: updated.defaultBranch,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    },
  })
}
