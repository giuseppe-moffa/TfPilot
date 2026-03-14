import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { getProjectByKey } from "@/lib/db/projects"

export async function GET(req: NextRequest) {
  const sessionOr401 = await requireSession()
  if (sessionOr401 instanceof NextResponse) return sessionOr401
  const session = sessionOr401
  const project = req.nextUrl.searchParams.get("project") ?? ""
  const envKey = req.nextUrl.searchParams.get("env") ?? ""

  if (!project || !envKey) {
    return NextResponse.json({ ok: false, error: "project and env are required" }, { status: 400 })
  }

  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "No org context" }, { status: 403 })
  }

  const proj = await getProjectByKey(session.orgId, project)
  if (!proj || !proj.repoFullName?.trim() || !proj.defaultBranch?.trim()) {
    return NextResponse.json({ ok: false, error: "Project not found or missing repo configuration" }, { status: 404 })
  }

  const [owner, repo] = proj.repoFullName.trim().split("/")
  if (!owner || !repo) {
    return NextResponse.json({ ok: false, error: "Project repo_full_name is invalid" }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    repo: `${owner}/${repo}`,
    base: proj.defaultBranch.trim(),
    envPath: `envs/${envKey}`,
  })
}
