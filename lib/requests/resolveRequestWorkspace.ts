/**
 * Resolve workspace reference for request create.
 * Model 2 only — workspace_id or (project_key, workspace_key, workspace_slug).
 */

import { getProjectByKey } from "@/lib/db/projects"
import {
  getWorkspaceById,
  getWorkspaceByRepoKeySlug,
  type Workspace,
} from "@/lib/db/workspaces"
import { validateWorkspaceSlug, computeWorkspaceRoot } from "@/lib/workspaces/helpers"

export type CreateWorkspaceInput =
  | { workspace_id: string }
  | { project_key: string; workspace_key: string; workspace_slug: string }

export type ResolvedRequestWorkspace = {
  project_key: string
  workspace_key: string
  workspace_slug: string
  workspace_id?: string
  targetRepo: { owner: string; repo: string; base: string; envPath: string }
}

export type ResolveRequestWorkspaceResult =
  | { ok: true; resolved: ResolvedRequestWorkspace }
  | { ok: false; error: string }

export type ResolveRequestWorkspaceDeps = {
  getWorkspaceById: (id: string) => Promise<Workspace | null>
  getWorkspaceByRepoKeySlug: (p: {
    repo_full_name: string
    workspace_key: string
    workspace_slug: string
  }) => Promise<Workspace | null>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ repoFullName: string; defaultBranch: string } | null>
}

/**
 * Resolves workspace for request create.
 * - workspace_id: lookup workspace, reject archived.
 * - (project_key, workspace_key, workspace_slug): lookup by repo+key+slug, reject if not found or archived.
 * - When both workspace_id and key+slug: must match.
 * Pass deps for testing (mock DB).
 */
export async function resolveRequestWorkspace(input: {
  workspace_id?: string
  project_key?: string
  workspace_key?: string
  workspace_slug?: string
  orgId?: string
  _deps?: ResolveRequestWorkspaceDeps
}): Promise<ResolveRequestWorkspaceResult> {
  const deps = input._deps
  const getById = deps?.getWorkspaceById ?? getWorkspaceById
  const getByKeySlug = deps?.getWorkspaceByRepoKeySlug ?? getWorkspaceByRepoKeySlug
  const getProjByKey = deps?.getProjectByKey ?? getProjectByKey

  const hasId = typeof input.workspace_id === "string" && input.workspace_id.trim() !== ""
  const hasKeySlug =
    typeof input.project_key === "string" &&
    input.project_key.trim() !== "" &&
    typeof input.workspace_key === "string" &&
    input.workspace_key.trim() !== "" &&
    typeof input.workspace_slug === "string" &&
    input.workspace_slug.trim() !== ""

  if (!hasId && !hasKeySlug) {
    return {
      ok: false,
      error: "Provide workspace_id, or (project_key, workspace_key, workspace_slug)",
    }
  }

  const orgId = input.orgId?.trim()
  if (!orgId) {
    return { ok: false, error: "orgId is required to resolve workspace" }
  }
  if (hasId) {
    const ws = await getById(input.workspace_id!.trim())
    if (!ws) {
      return { ok: false, error: "Workspace not found" }
    }
    if (ws.archived_at) {
      return { ok: false, error: "Workspace is archived" }
    }
    if (hasKeySlug) {
      const pk = input.project_key!.trim()
      const wk = input.workspace_key!.trim()
      const wss = input.workspace_slug!.trim()
      if (ws.project_key !== pk || ws.workspace_key !== wk || ws.workspace_slug !== wss) {
        return { ok: false, error: "workspace_id does not match (project_key, workspace_key, workspace_slug)" }
      }
    }
    return buildResolved(ws, ws.project_key, orgId, getProjByKey)
  }

  if (hasKeySlug) {
    const slugResult = validateWorkspaceSlug(input.workspace_slug!.trim())
    if (!slugResult.ok) {
      return { ok: false, error: slugResult.error }
    }
    const project_key = input.project_key!.trim()
    const project = await getProjByKey(orgId, project_key)
    if (!project || !project.repoFullName?.trim()) {
      return { ok: false, error: "Project not found or missing repo configuration" }
    }
    const repoFullName = project.repoFullName.trim()
    const ws = await getByKeySlug({
      repo_full_name: repoFullName,
      workspace_key: input.workspace_key!.trim(),
      workspace_slug: input.workspace_slug!.trim(),
    })
    if (!ws) {
      return { ok: false, error: "Workspace not found" }
    }
    if (ws.archived_at) {
      return { ok: false, error: "Workspace is archived" }
    }
    return buildResolved(ws, project_key, orgId, getProjByKey)
  }

  return {
    ok: false,
    error: "Provide workspace_id, or (project_key, workspace_key, workspace_slug)",
  }
}

async function buildResolved(
  ws: Workspace,
  project_key: string,
  orgId: string,
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ repoFullName: string; defaultBranch: string } | null>
): Promise<ResolveRequestWorkspaceResult> {
  const project = await getProjectByKey(orgId, project_key)
  if (!project || !project.repoFullName?.trim() || !project.defaultBranch?.trim()) {
    return { ok: false, error: "Project not found or missing repo configuration" }
  }
  const [owner, repo] = project.repoFullName.trim().split("/")
  if (!owner || !repo) {
    return { ok: false, error: "Project repo_full_name is invalid (expected owner/repo)" }
  }
  const envPath = computeWorkspaceRoot(ws.workspace_key, ws.workspace_slug)
  return {
    ok: true,
    resolved: {
      project_key: ws.project_key,
      workspace_key: ws.workspace_key,
      workspace_slug: ws.workspace_slug,
      workspace_id: ws.workspace_id,
      targetRepo: {
        owner,
        repo,
        base: project.defaultBranch.trim(),
        envPath,
      },
    },
  }
}
