/**
 * POST /api/org/projects/[projectId]/users — Assign/update direct user role.
 * Requires manage_access. Cross-org / not-found → 404. Permission denied → 403.
 *
 * Contract: body { login, role }. role required.
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
import {
  upsertProjectUserRole,
  isValidProjectRole,
  type ProjectRoleDb,
} from "@/lib/db/projectRoles"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import type { AuditEventInput } from "@/lib/audit/types"

export type ProjectUsersRouteDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload | null) => Promise<NextResponse | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  getProjectById: (projectId: string) => Promise<{ orgId: string; projectKey: string } | null>
  upsertProjectUserRole: (projectId: string, userLogin: string, role: ProjectRoleDb) => Promise<boolean>
  isValidProjectRole: (r: unknown) => r is ProjectRoleDb
  writeAuditEvent: (deps: unknown, event: AuditEventInput) => Promise<void>
}

const realDeps: ProjectUsersRouteDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  buildPermissionContext,
  requireProjectPermission,
  getProjectById,
  upsertProjectUserRole,
  isValidProjectRole,
  writeAuditEvent: async (deps, event) => {
    await writeAuditEvent(deps as typeof auditWriteDeps, event)
  },
}

async function requireAuthAndOrg(deps: ProjectUsersRouteDeps): Promise<
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

export function makeProjectUsersPOST(deps: ProjectUsersRouteDeps) {
  return async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ projectId: string }> }
  ) {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    const { projectId } = await ctx.params

    let body: { login?: unknown; role?: unknown }
    try {
      body = (await req.json()) as { login?: unknown; role?: unknown }
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const login = typeof body.login === "string" ? body.login.trim() : ""
    const roleRaw = typeof body.role === "string" ? body.role.trim() : ""

    if (!login) {
      return NextResponse.json({ error: "login is required" }, { status: 400 })
    }
    if (!roleRaw || !deps.isValidProjectRole(roleRaw)) {
      return NextResponse.json(
        { error: "role must be one of: viewer, planner, operator, deployer, admin" },
        { status: 400 }
      )
    }
    const role = roleRaw as ProjectRoleDb

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

    await deps.upsertProjectUserRole(projectId, login, role)
    deps.writeAuditEvent(auditWriteDeps, {
      org_id: session.orgId,
      actor_login: session.login,
      source: "user",
      event_type: "project_user_role_assigned",
      entity_type: "project",
      entity_id: projectId,
      metadata: { user_login: login, role, project_key: project.projectKey },
    })

    return NextResponse.json({ ok: true })
  }
}

export const POST = makeProjectUsersPOST(realDeps)
