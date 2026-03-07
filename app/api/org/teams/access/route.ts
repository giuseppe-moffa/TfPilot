/**
 * GET /api/org/teams/access — List project-team role grants.
 * POST /api/org/teams/access — Assign/update team role on project.
 * DELETE /api/org/teams/access — Remove team role from project.
 *
 * Transitional: maps legacy "team access" to project_team_roles. Requires manage_access.
 * Cross-org / not-found → 404. Permission denied → 403.
 *
 * POST contract: { teamId, projectId, role? }. role optional, defaults to "operator".
 * GET contract: { grants: [{ teamId, projectId, role }] }.
 * DELETE contract: { teamId, projectId }.
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
import { getTeamById } from "@/lib/db/teams"
import { getProjectById } from "@/lib/db/projects"
import {
  listProjectTeamRolesByOrg,
  upsertProjectTeamRole,
  deleteProjectTeamRole,
  isValidProjectRole,
  type ProjectRoleDb,
} from "@/lib/db/projectRoles"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import type { AuditEventInput } from "@/lib/audit/types"

export type TeamsAccessDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: ProjectPermission
  ) => Promise<unknown>
  getTeamById: (teamId: string) => Promise<{ orgId: string; slug: string } | null>
  getProjectById: (projectId: string) => Promise<{ orgId: string; projectKey: string } | null>
  listProjectTeamRolesByOrg: (orgId: string) => Promise<{ teamId: string; projectId: string; role: string }[]>
  upsertProjectTeamRole: (projectId: string, teamId: string, role: ProjectRoleDb) => Promise<boolean>
  deleteProjectTeamRole: (projectId: string, teamId: string) => Promise<boolean>
  isValidProjectRole: (r: unknown) => r is ProjectRoleDb
  writeAuditEvent: (deps: unknown, event: AuditEventInput) => Promise<void>
}

const realDeps: TeamsAccessDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  buildPermissionContext,
  requireProjectPermission,
  getTeamById,
  getProjectById,
  listProjectTeamRolesByOrg,
  upsertProjectTeamRole,
  deleteProjectTeamRole,
  isValidProjectRole,
  writeAuditEvent: async (deps, event) => {
    await writeAuditEvent(deps as typeof auditWriteDeps, event)
  },
}

async function requireAuthAndOrg(deps: TeamsAccessDeps): Promise<
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

export function makeTeamsAccessGET(deps: TeamsAccessDeps) {
  return async function GET() {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    const ctx = await deps.buildPermissionContext(session.login, session.orgId)
    const allGrants = await deps.listProjectTeamRolesByOrg(session.orgId)

    const filtered: { teamId: string; projectId: string; role: string }[] = []
    const projectIdsWithAccess = new Set<string>()
    for (const g of allGrants) {
      if (projectIdsWithAccess.has(g.projectId)) {
        filtered.push({ teamId: g.teamId, projectId: g.projectId, role: g.role })
        continue
      }
      try {
        await deps.requireProjectPermission(ctx, g.projectId, "manage_access")
        projectIdsWithAccess.add(g.projectId)
        filtered.push({ teamId: g.teamId, projectId: g.projectId, role: g.role })
      } catch {
        // Skip grants for projects without manage_access
      }
    }

    return NextResponse.json({ grants: filtered })
  }
}

export function makeTeamsAccessPOST(deps: TeamsAccessDeps) {
  return async function POST(req: NextRequest) {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    let body: { teamId?: unknown; projectId?: unknown; role?: unknown }
    try {
      body = (await req.json()) as { teamId?: unknown; projectId?: unknown; role?: unknown }
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const teamId = typeof body.teamId === "string" ? body.teamId.trim() : ""
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
    const roleRaw = typeof body.role === "string" ? body.role.trim() : ""

    if (!teamId || !projectId) {
      return NextResponse.json({ error: "teamId and projectId are required" }, { status: 400 })
    }

    // role optional: default "operator" for legacy-UI compatibility (teams page sends only { teamId, projectId }).
    // Target env0-style model is explicit role assignment; this bridges the old boolean-access mapping.
    // See RBAC_OVERHAUL_ARCHITECTURE_DELTA.
    const role = roleRaw && deps.isValidProjectRole(roleRaw)
      ? (roleRaw as ProjectRoleDb)
      : "operator"
    if (roleRaw && !deps.isValidProjectRole(roleRaw)) {
      return NextResponse.json(
        { error: "role must be one of: viewer, planner, operator, deployer, admin" },
        { status: 400 }
      )
    }

    const team = await deps.getTeamById(teamId)
    if (!team || team.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const project = await deps.getProjectById(projectId)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const ctx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(ctx, projectId, "manage_access")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw e
    }

    await deps.upsertProjectTeamRole(projectId, teamId, role)
    deps.writeAuditEvent(auditWriteDeps, {
      org_id: session.orgId,
      actor_login: session.login,
      source: "user",
      event_type: "project_access_granted",
      entity_type: "project",
      entity_id: projectId,
      metadata: { team_id: teamId, team_slug: team.slug, project_key: project.projectKey, role },
    })

    return NextResponse.json({ ok: true })
  }
}

export function makeTeamsAccessDELETE(deps: TeamsAccessDeps) {
  return async function DELETE(req: NextRequest) {
    const result = await requireAuthAndOrg(deps)
    if ("error" in result) return result.error
    const { session } = result

    let body: { teamId?: unknown; projectId?: unknown }
    try {
      body = (await req.json()) as { teamId?: unknown; projectId?: unknown }
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const teamId = typeof body.teamId === "string" ? body.teamId.trim() : ""
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
    if (!teamId || !projectId) {
      return NextResponse.json({ error: "teamId and projectId are required" }, { status: 400 })
    }

    const team = await deps.getTeamById(teamId)
    if (!team || team.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const project = await deps.getProjectById(projectId)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const ctx = await deps.buildPermissionContext(session.login, session.orgId)
    try {
      await deps.requireProjectPermission(ctx, projectId, "manage_access")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw e
    }

    const removed = await deps.deleteProjectTeamRole(projectId, teamId)
    if (removed) {
      deps.writeAuditEvent(auditWriteDeps, {
        org_id: session.orgId,
        actor_login: session.login,
        source: "user",
        event_type: "project_access_revoked",
        entity_type: "project",
        entity_id: projectId,
        metadata: { team_id: teamId, team_slug: team.slug, project_key: project.projectKey },
      })
    }
    return NextResponse.json({ ok: true })
  }
}

export const GET = makeTeamsAccessGET(realDeps)
export const POST = makeTeamsAccessPOST(realDeps)
export const DELETE = makeTeamsAccessDELETE(realDeps)
