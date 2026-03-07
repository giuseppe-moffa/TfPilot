/**
 * DELETE /api/org/projects/[projectId]/users/[login] — Remove direct user role.
 * Requires manage_access. Cross-org / not-found → 404. Permission denied → 403.
 *
 * Contract: path params projectId, login.
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
import { getProjectById } from "@/lib/db/projects"
import { deleteProjectUserRole } from "@/lib/db/projectRoles"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import type { AuditEventInput } from "@/lib/audit/types"

export type ProjectUserDeleteRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload | null) => Promise<NextResponse | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  getProjectById: (projectId: string) => Promise<{ orgId: string; projectKey: string } | null>
  deleteProjectUserRole: (projectId: string, userLogin: string) => Promise<boolean>
  writeAuditEvent: (deps: unknown, event: AuditEventInput) => Promise<void>
}

const realDeps: ProjectUserDeleteRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  buildPermissionContext,
  requireProjectPermission,
  getProjectById,
  deleteProjectUserRole,
  writeAuditEvent: async (deps, event) => {
    await writeAuditEvent(deps as typeof auditWriteDeps, event)
  },
}

async function requireAuthAndOrg(deps: ProjectUserDeleteRouteDeps): Promise<
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

export function makeProjectUserDELETE(deps: ProjectUserDeleteRouteDeps) {
  return async function DELETE(
    _req: NextRequest,
    ctx: { params: Promise<{ projectId: string; login: string }> }
  ) {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    const { projectId, login } = await ctx.params
    if (!login?.trim()) {
      return NextResponse.json({ error: "login is required" }, { status: 400 })
    }

    const project = await deps.getProjectById(projectId)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const permissionCtx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(permissionCtx, projectId, "manage_access")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw e
    }

    const removed = await deps.deleteProjectUserRole(projectId, login)
    if (removed) {
      deps.writeAuditEvent(auditWriteDeps, {
        org_id: session.orgId,
        actor_login: session.login,
        source: "user",
        event_type: "project_user_role_removed",
        entity_type: "project",
        entity_id: projectId,
        metadata: { user_login: login, project_key: project.projectKey },
      })
    }

    return NextResponse.json({ ok: true })
  }
}

export const DELETE = makeProjectUserDELETE(realDeps)
