/**
 * Require project permission for a request-scoped action.
 * Resolves org ownership, project, and permission via the new RBAC engine.
 */

import { NextResponse } from "next/server"

import { getProjectByKey } from "@/lib/db/projects"
import { getUserOrgRole } from "@/lib/auth/orgRoles"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
  type ProjectPermission,
} from "@/lib/auth/permissions"

export type RequireRequestPermissionDeps = {
  getRequestOrgId: (requestId: string) => Promise<string | null>
}

/**
 * Require project permission for an action on a request.
 * Returns NextResponse (404 or 403) on failure, null on success.
 *
 * - 404: cross-org, request not found, project not found
 * - 403: insufficient project permission
 */
export async function requireRequestProjectPermission(
  session: { login: string; orgId?: string | null },
  request: { project_key?: string; org_id?: string },
  requestId: string,
  permission: ProjectPermission,
  deps: RequireRequestPermissionDeps
): Promise<NextResponse | null> {
  if (!session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const resourceOrgId = request.org_id ?? (await deps.getRequestOrgId(requestId))
  if (!resourceOrgId || resourceOrgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const projectKey = request.project_key
  if (!projectKey) {
    // Legacy request without project_key: require org admin (short-circuits to full authority)
    const orgRole = await getUserOrgRole(session.login, session.orgId)
    if (orgRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return null
  }
  const project = await getProjectByKey(session.orgId, projectKey)
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  try {
    const ctx = await buildPermissionContext(session.login, session.orgId)
    await requireProjectPermission(ctx, project.id, permission)
    return null
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }
}
