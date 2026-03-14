import { NextResponse } from "next/server"

import { requireAdminByEmail } from "@/lib/auth/admin"
import { getSessionFromCookies } from "@/lib/auth/session"
import type { WorkspaceTemplateDocument } from "@/lib/workspace-templates-store"
import {
  workspaceTemplatesIndexExists,
  seedWorkspaceTemplates,
} from "@/lib/workspace-templates-store"

/** Default workspace templates for seed (new S3 layout only). No blank. */
const DEFAULT_WORKSPACE_TEMPLATES: WorkspaceTemplateDocument[] = [
  {
    id: "baseline-ai-service",
    name: "Baseline AI Service",
    version: "v1",
    description: "ECR repo, CloudWatch logs, IAM role, and S3 bucket for AI/ML workloads.",
    modules: [
      { id: "ecr-repo", source: "modules/ecr-repo", version: "1", config: {} },
      { id: "cloudwatch-log-group", source: "modules/cloudwatch-log-group", version: "1", config: {} },
      { id: "iam-role", source: "modules/iam-role", version: "1", config: {} },
      { id: "s3-bucket", source: "modules/s3-bucket", version: "1", config: {} },
    ],
  },
  {
    id: "baseline-app-service",
    name: "Baseline App Service",
    version: "v1",
    description: "CloudWatch logs, IAM role, and S3 bucket for application services.",
    modules: [
      { id: "cloudwatch-log-group", source: "modules/cloudwatch-log-group", version: "1", config: {} },
      { id: "iam-role", source: "modules/iam-role", version: "1", config: {} },
      { id: "s3-bucket", source: "modules/s3-bucket", version: "1", config: {} },
    ],
  },
  {
    id: "baseline-worker-service",
    name: "Baseline Worker Service",
    version: "v1",
    description: "CloudWatch logs, IAM role, and S3 bucket for background workers.",
    modules: [
      { id: "cloudwatch-log-group", source: "modules/cloudwatch-log-group", version: "1", config: {} },
      { id: "iam-role", source: "modules/iam-role", version: "1", config: {} },
      { id: "s3-bucket", source: "modules/s3-bucket", version: "1", config: {} },
    ],
  },
]

/**
 * POST /api/workspace-templates/admin/seed
 * One-time bootstrap: writes default workspace templates to S3 (templates/workspaces/).
 * Idempotent: 409 if index already exists.
 */
export async function POST() {
  const forbidden = await requireAdminByEmail()
  if (forbidden) return forbidden
  const session = await getSessionFromCookies()
  if (!session?.orgId) {
    return NextResponse.json({ error: "No org context" }, { status: 403 })
  }

  if (await workspaceTemplatesIndexExists()) {
    return NextResponse.json(
      { error: "WORKSPACE_TEMPLATES_ALREADY_INITIALIZED" },
      { status: 409 }
    )
  }

  try {
    const { created } = await seedWorkspaceTemplates(DEFAULT_WORKSPACE_TEMPLATES)
    return NextResponse.json({ created })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === "WORKSPACE_TEMPLATES_ALREADY_INITIALIZED") {
      return NextResponse.json(
        { error: "WORKSPACE_TEMPLATES_ALREADY_INITIALIZED" },
        { status: 409 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error("[workspace-templates/admin/seed] error:", err)
    return NextResponse.json(
      { error: "Failed to seed workspace templates", detail: message },
      { status: 500 }
    )
  }
}
