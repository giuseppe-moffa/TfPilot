import { NextRequest, NextResponse } from "next/server"
import { resolveInfraRepo } from "@/config/infra-repos"

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project") ?? ""
  const environment = req.nextUrl.searchParams.get("env") ?? ""

  if (!project || !environment) {
    return NextResponse.json({ ok: false, error: "project and env are required" }, { status: 400 })
  }

  const target = resolveInfraRepo(project, environment)
  if (!target) {
    return NextResponse.json({ ok: false, error: "No infra repo configured for project/env" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    repo: `${target.owner}/${target.repo}`,
    base: target.base,
    envPath: target.envPath,
  })
}
