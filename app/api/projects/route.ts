import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  listProjectsByOrg,
  createProject,
  isValidProjectKey,
  isValidRepoFullName,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/projects"
import { listWorkspaces } from "@/lib/db/workspaces"
import { upsertProjectUserRole } from "@/lib/db/projectRoles"

export async function GET() {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401

  const session = sessionOr401
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }

  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  try {
    const [projects, wsResult] = await Promise.all([
      listProjectsByOrg(session.orgId),
      listWorkspaces({ orgId: session.orgId, include_archived: false }),
    ])
    const workspaces = wsResult ?? []

    const workspaceCountByProject: Record<string, number> = {}
    for (const ws of workspaces) {
      const key = ws.project_key
      workspaceCountByProject[key] = (workspaceCountByProject[key] ?? 0) + 1
    }

    const result = projects.map((p) => ({
      id: p.id,
      project_key: p.projectKey,
      name: p.name,
      workspace_count: workspaceCountByProject[p.projectKey] ?? 0,
    }))

    return NextResponse.json({ projects: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401

  const session = sessionOr401
  if (!session.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }

  const archivedRes = await requireActiveOrg(session)
  if (archivedRes) return archivedRes

  let body: {
    name?: unknown
    project_key?: unknown
    repo_full_name?: unknown
    default_branch?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Validate all required fields
  const errors: string[] = []

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) errors.push("name is required")
  else if (name.length > 128) errors.push("name must be 128 characters or fewer")

  const projectKey = typeof body.project_key === "string" ? body.project_key.trim().toLowerCase() : ""
  if (!projectKey) errors.push("project_key is required")
  else if (!isValidProjectKey(projectKey))
    errors.push("project_key must be lowercase letters, digits, and hyphens (no leading/trailing hyphens)")

  const repoFullName = typeof body.repo_full_name === "string" ? body.repo_full_name.trim() : ""
  if (!repoFullName) errors.push("repo_full_name is required")
  else if (!isValidRepoFullName(repoFullName))
    errors.push("repo_full_name must be in owner/repo format")

  const defaultBranch = typeof body.default_branch === "string" ? body.default_branch.trim() : ""
  if (!defaultBranch) errors.push("default_branch is required")
  else if (defaultBranch.length > 255) errors.push("default_branch must be 255 characters or fewer")

  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 400 })
  }

  try {
    const project = await createProject({
      orgId: session.orgId,
      projectKey,
      name,
      repoFullName,
      defaultBranch,
    })

    if (!project) {
      return NextResponse.json({ error: "Database not configured or unavailable" }, { status: 503 })
    }

    // Auto-assign creator as project admin
    await upsertProjectUserRole(project.id, session.login, "admin")

    return NextResponse.json(
      {
        project: {
          id: project.id,
          project_key: project.projectKey,
          name: project.name,
          repo_full_name: project.repoFullName,
          default_branch: project.defaultBranch,
          created_at: project.createdAt,
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const pgErr = err as { code?: string }
    if (pgErr?.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "A project with this key already exists in your organisation" },
        { status: 409 }
      )
    }
    console.error("[POST /api/projects] error:", err)
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
