/**
 * GET /api/environments — List environments (DB-backed).
 * POST /api/environments — Create environment + bootstrap PR.
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
  listEnvironments,
  createEnvironment,
  getEnvironmentByRepoKeySlug,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/environments"
import { validateCreateEnvironmentBody } from "@/lib/environments/helpers"
import {
  validateTemplateIdOrThrow,
  INVALID_ENV_TEMPLATE,
  ENV_TEMPLATES_NOT_INITIALIZED,
} from "@/lib/environments/validateTemplateId"
import { resolveInfraRepoByProjectAndEnvKey } from "@/config/infra-repos"
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

  const rows = await listEnvironments({ orgId: session.orgId, project_key, include_archived })
  if (rows === null) {
    return NextResponse.json(
      { error: "Database not configured or unavailable" },
      { status: 503 }
    )
  }

  return NextResponse.json({ environments: rows })
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

  let body: { project_key?: string; environment_key?: string; environment_slug?: string; template_id?: string | null }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const errors = validateCreateEnvironmentBody(body)
  if (errors) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 400 })
  }

  try {
    await validateTemplateIdOrThrow(body.template_id, session.orgId)
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === INVALID_ENV_TEMPLATE) {
      return NextResponse.json({ error: INVALID_ENV_TEMPLATE }, { status: 400 })
    }
    if (code === ENV_TEMPLATES_NOT_INITIALIZED) {
      return NextResponse.json(
        { error: ENV_TEMPLATES_NOT_INITIALIZED },
        { status: 503 }
      )
    }
    console.error("[environments] template validation error:", err)
    return NextResponse.json(
      { error: "Failed to load environment templates" },
      { status: 500 }
    )
  }

  const project_key = (typeof body.project_key === "string" ? body.project_key : "").trim()
  const environment_key = (typeof body.environment_key === "string" ? body.environment_key : "")
    .trim()
    .toLowerCase()
  const environment_slug = (typeof body.environment_slug === "string" ? body.environment_slug : "").trim()

  const project = await getProjectByKey(session.orgId!, project_key)
  if (!project || project.orgId !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const ctx = await buildPermissionContext(session.login, session.orgId!)
  try {
    await requireProjectPermission(ctx, project.id, "deploy_env")
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Create not permitted for your role" }, { status: 403 })
    }
    throw e
  }

  const infra = resolveInfraRepoByProjectAndEnvKey(project_key, environment_key)
  if (!infra) {
    return NextResponse.json(
      { error: "No infra repo configured for project_key + environment_key" },
      { status: 404 }
    )
  }

  const repo_full_name = `${infra.owner}/${infra.repo}`

  const template_version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.TFPILOT_APP_COMMIT ||
    "v1"

  let env
  try {
    env = await createEnvironment({
      orgId: session.orgId,
      project_key,
      repo_full_name,
      environment_key,
      environment_slug,
      template_id:
        typeof body.template_id === "string" && body.template_id.trim() !== ""
          ? body.template_id.trim()
          : null,
      template_version,
    })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e?.code === PG_UNIQUE_VIOLATION) {
      const existing = await getEnvironmentByRepoKeySlug({
        repo_full_name,
        environment_key,
        environment_slug,
      })
      return NextResponse.json(
        {
          error: "Environment already exists",
          environment_id: existing?.environment_id,
        },
        { status: 409 }
      )
    }
    throw err
  }

  if (!env) {
    return NextResponse.json(
      { error: "Database not configured or unavailable" },
      { status: 503 }
    )
  }

  logInfo("env.create", {
    env_id: env.environment_id,
    project_key: env.project_key,
    environment_key: env.environment_key,
    environment_slug: env.environment_slug,
  })
  incrementEnvMetric("env.create", { env_id: env.environment_id })

  const bootstrapResult = await createBootstrapPr(token, {
    owner: infra.owner,
    repo: infra.repo,
    base: infra.base,
  }, {
    environment_id: env.environment_id,
    project_key,
    environment_key,
    environment_slug,
  })

  return NextResponse.json(
    {
      environment: env,
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
