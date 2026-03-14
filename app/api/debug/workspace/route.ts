import { NextResponse } from "next/server"

// Mark as dynamic to prevent build-time evaluation
export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Import env lazily to avoid build-time errors
  const { env } = await import("@/lib/config/env")

  return NextResponse.json({
    githubOwner: env.GITHUB_DEFAULT_OWNER,
    baseBranch: env.GITHUB_DEFAULT_BASE_BRANCH,
    workflows: {
      plan: env.GITHUB_PLAN_WORKFLOW_FILE,
      apply: env.GITHUB_APPLY_WORKFLOW_FILE,
    },
    openaiModel: env.OPENAI_MODEL,
    region: env.TFPILOT_DEFAULT_REGION,
    appName: env.TFPILOT_APP_NAME,
  })
}
