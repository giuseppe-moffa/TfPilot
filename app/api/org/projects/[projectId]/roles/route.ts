/**
 * GET /api/org/projects/[projectId]/roles — List user and team role assignments.
 * Requires manage_access. Cross-org / not-found → 404. Permission denied → 403.
 *
 * Contract: { users: [{ login, role }], teams: [{ teamId, role }] }.
 */

import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
  type PermissionContext,
  type ProjectPermission,
} from "@/lib/auth/permissions"
import { resolveProjectByIdOrKey } from "@/lib/db/projects"
import {
  listProjectUserRolesByProject,
  listProjectTeamRolesByProject,
  type ProjectRoleDb,
} from "@/lib/db/projectRoles"

export type ProjectRolesRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload | null) => Promise<NextResponse | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  resolveProject: (orgId: string, projectIdOrKey: string) => Promise<{ id: string; orgId: string } | null>
  listProjectUserRolesByProject: (projectId: string) => Promise<{ userLogin: string; role: string }[]>
  listProjectTeamRolesByProject: (projectId: string) => Promise<{ teamId: string; role: string }[]>
}

const realDeps: ProjectRolesRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  buildPermissionContext,
  requireProjectPermission,
  resolveProject: resolveProjectByIdOrKey,
  listProjectUserRolesByProject,
  listProjectTeamRolesByProject,
}

async function requireAuthAndOrg(deps: ProjectRolesRouteDeps): Promise<
  | { error: NextResponse }
  | { session: { login: string; orgId: string } }
> {
  const session = await deps.getSessionFromCookies()
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  if (!session.orgId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  const archivedRes = await deps.requireActiveOrg(session)
  if (archivedRes) return { error: archivedRes }
  return { session: { login: session.login, orgId: session.orgId } }
}

export function makeProjectRolesGET(deps: ProjectRolesRouteDeps) {
  return async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ projectId: string }> }
  ) {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    const { projectId } = await ctx.params

    const project = await deps.resolveProject(session.orgId, projectId)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const permissionCtx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(permissionCtx, project.id, "manage_access")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw e
    }

    const [users, teams] = await Promise.all([
      deps.listProjectUserRolesByProject(project.id),
      deps.listProjectTeamRolesByProject(project.id),
    ])

    return NextResponse.json({
      users: users.map((u) => ({ login: u.userLogin, role: u.role })),
      teams: teams.map((t) => ({ teamId: t.teamId, role: t.role })),
    })
  }
}

export const GET = makeProjectRolesGET(realDeps)
