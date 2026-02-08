import { randomBytes } from "node:crypto"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"

import { mockRequests as seedRequests } from "@/lib/data/mock-requests"
import { gh } from "@/lib/github/client"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { loadModuleMeta } from "../modules/route"

type RequestPayload = {
  project?: string
  environment?: string
  module?: string
  config?: Record<string, unknown>
}

type StoredRequest = {
  id: string
  project: string
  environment: string
  module: string
  config: Record<string, unknown>
  receivedAt: string
  updatedAt: string
  status:
    | "created"
    | "pr_open"
    | "planning"
    | "plan_ready"
    | "awaiting_approval"
    | "merged"
    | "applying"
    | "complete"
    | "failed"
  planRun?: {
    generatedPath: string
    triggeredAt: string
    workflowUrl?: string
    runId?: number
  }
  plan?: {
    diff: string
  }
  branchName?: string
  prNumber?: number
  prUrl?: string
  commitSha?: string
  workflowRunId?: number
  applyRunId?: number
  pullRequest?: {
    url: string
    number: number
    branch: string
    status: "open" | "closed" | "merged"
    title: string
    files: Array<{ path: string; diff: string }>
    planOutput: string
  }
}

const STORAGE_DIR = path.join(process.cwd(), "tmp")
const STORAGE_FILE = path.join(STORAGE_DIR, "requests.json")
const GENERATED_BASE = path.join(process.cwd(), "..", "infra", "generated")
const OWNER = process.env.GITHUB_OWNER ?? "giuseppe-moffa"
const REPO = process.env.GITHUB_REPO ?? "TfPilot"
const PLAN_WORKFLOW = process.env.GITHUB_PLAN_WORKFLOW ?? "plan.yml"

async function seedRequestsFile() {
  try {
    // If file already exists and is readable, do nothing.
    await readFile(STORAGE_FILE, "utf8")
    return
  } catch {
    /* file missing; continue to seed */
  }

  try {
    await mkdir(STORAGE_DIR, { recursive: true })
    const seeds: StoredRequest[] = seedRequests.map((r) => ({
      id: r.id,
      project: r.project,
      environment: r.environment,
      module: "service",
      config: r.config ?? {},
      receivedAt: r.createdAt,
      updatedAt: r.updatedAt,
      status: "plan_ready",
      plan: r.plan,
    }))
    await writeFile(STORAGE_FILE, JSON.stringify(seeds, null, 2), "utf8")
    console.log("[api/requests] seeded tmp/requests.json with demo data")
  } catch (err) {
    console.warn("[api/requests] failed to seed requests file", err)
  }
}

// Fire-and-forget seeding on module load
seedRequestsFile()

function validatePayload(body: RequestPayload) {
  const errors: string[] = []

  if (!body.project || typeof body.project !== "string") {
    errors.push("project is required and must be a string")
  }
  if (!body.environment || typeof body.environment !== "string") {
    errors.push("environment is required and must be a string")
  }
  if (!body.module || typeof body.module !== "string") {
    errors.push("module is required and must be a string")
  }
  if (
    body.config === undefined ||
    body.config === null ||
    typeof body.config !== "object" ||
    Array.isArray(body.config)
  ) {
    errors.push("config is required and must be an object")
  }

  return errors
}

function planDiffForModule(mod?: string) {
  switch (mod) {
    case "ECS Service":
    case "service":
      return "+ aws_ecs_service.app"
    case "SQS Queue":
    case "queue":
      return "+ aws_sqs_queue.main"
    case "RDS Database":
    case "database":
      return "+ aws_db_instance.main"
    default:
      return "+ aws_null_resource.default"
  }
}

function renderHclValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (Array.isArray(value) || typeof value === "object") {
    return `jsonencode(${JSON.stringify(value)})`
  }
  return `"${String(value)}"`
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

async function readFilesRecursive(
  dir: string,
  repoPrefix: string
): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<{ path: string; content: string }> = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await readFilesRecursive(full, path.join(repoPrefix, entry.name))
      files.push(...nested)
    } else if (entry.isFile()) {
      const content = await readFile(full, "utf8")
      files.push({ path: path.join(repoPrefix, entry.name), content })
    }
  }
  return files
}

async function generateTerraformFiles(request: StoredRequest) {
  const generatedDir = path.join(GENERATED_BASE, request.id)
  const mainPath = path.join(generatedDir, "main.tf")

  await ensureDir(generatedDir)

  const moduleSource = "../../terraform-modules/" + request.module
  const renderedInputs = Object.entries(request.config).map(
    ([key, val]) => `  ${key} = ${renderHclValue(val)}`
  )

  const mainTf = `terraform {
  required_version = ">= 1.5.0"
}

module "requested" {
  source = "${moduleSource}"
${renderedInputs.join("\n")}
}
`

  await writeFile(mainPath, mainTf, "utf8")
  const files = await readFilesRecursive(generatedDir, path.join("infra", "generated", request.id))
  return { generatedPath: mainPath, files }
}

async function createBranchCommitPrAndPlan(
  token: string,
  request: StoredRequest,
  files: Array<{ path: string; content: string }>
) {
  const branchName = `request/${request.id}`

  const refRes = await gh(token, `/repos/${OWNER}/${REPO}/git/ref/heads/main`)
  const refJson = (await refRes.json()) as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) throw new Error("Failed to resolve base branch SHA")

  // create branch (ignore if exists)
  try {
    await gh(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    })
  } catch (err: any) {
    if (err?.status !== 422) {
      throw err
    }
  }

  const baseCommitRes = await gh(token, `/repos/${OWNER}/${REPO}/git/commits/${baseSha}`)
  const baseCommit = (await baseCommitRes.json()) as { tree?: { sha?: string } }
  const baseTreeSha = baseCommit.tree?.sha
  if (!baseTreeSha) throw new Error("Failed to resolve base tree")

  const blobs: Array<{ path: string; sha: string }> = []
  for (const file of files) {
    const blobRes = await gh(token, `/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    })
    const blobJson = (await blobRes.json()) as { sha?: string }
    if (!blobJson.sha) throw new Error("Failed to create blob")
    blobs.push({ path: file.path, sha: blobJson.sha })
  }

  const treeRes = await gh(token, `/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  })
  const treeJson = (await treeRes.json()) as { sha?: string }
  if (!treeJson.sha) throw new Error("Failed to create tree")

  const commitRes = await gh(token, `/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `chore: infra request ${request.id}`,
      tree: treeJson.sha,
      parents: [baseSha],
    }),
  })
  const commitJson = (await commitRes.json()) as { sha?: string }
  if (!commitJson.sha) throw new Error("Failed to create commit")

  await gh(token, `/repos/${OWNER}/${REPO}/git/refs/heads/${branchName}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitJson.sha, force: true }),
  })

  const prRes = await gh(token, `/repos/${OWNER}/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Infra request ${request.id}: ${request.module}`,
      head: branchName,
      base: "main",
      body: `Automated request for ${request.project}/${request.environment}\n\nModule: ${request.module}\nRequest ID: ${request.id}`,
    }),
  })
  const prJson = (await prRes.json()) as { number?: number; html_url?: string }
  if (!prJson.number || !prJson.html_url) throw new Error("Failed to open PR")

  await gh(token, `/repos/${OWNER}/${REPO}/actions/workflows/${PLAN_WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: branchName,
      inputs: {
        request_id: request.id,
        environment: request.environment,
      },
    }),
  })

  let workflowRunId: number | undefined
  try {
    const runsRes = await gh(
      token,
      `/repos/${OWNER}/${REPO}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(
        branchName
      )}&per_page=1`
    )
    const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
    workflowRunId = runsJson.workflow_runs?.[0]?.id
  } catch {
    /* ignore */
  }

  return {
    branchName,
    prNumber: prJson.number,
    prUrl: prJson.html_url,
    commitSha: commitJson.sha,
    workflowRunId,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestPayload
    const errors = validatePayload(body)

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      )
    }

    // validate module exists
    const metaPath = path.join(process.cwd(), "..", "terraform-modules", body.module!, "metadata.json")
    const hasMeta = await stat(metaPath).then(() => true).catch(() => false)
    if (!hasMeta) {
      return NextResponse.json({ success: false, error: "Unknown module" }, { status: 400 })
    }
    const meta = await loadModuleMeta(metaPath)
    if (!meta) {
      return NextResponse.json({ success: false, error: "Invalid module metadata" }, { status: 400 })
    }

    const token = await getGitHubAccessToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    const requestId = `req_${randomBytes(3).toString("hex").toUpperCase()}`

    console.log("[api/requests] received payload:", body)
    console.log("[api/requests] Triggering generation for", requestId)
    console.log("[api/requests] module =", body.module)

    // ensure storage directory exists
    await mkdir(STORAGE_DIR, { recursive: true })

    // read existing requests (or init empty)
    let existing: StoredRequest[] = []
    try {
      const contents = await readFile(STORAGE_FILE, "utf8")
      const parsed = JSON.parse(contents)
      if (Array.isArray(parsed)) {
        existing = parsed as StoredRequest[]
      }
    } catch {
      existing = []
    }

    const newRequest: StoredRequest = {
      id: requestId,
      project: body.project!,
      environment: body.environment!,
      module: body.module!,
      config: body.config as Record<string, unknown>,
      receivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "created",
      plan: { diff: planDiffForModule(body.module) },
    }

    const generated = await generateTerraformFiles(newRequest)
    const ghResult = await createBranchCommitPrAndPlan(token, newRequest, generated.files)

    newRequest.branchName = ghResult.branchName
    newRequest.prNumber = ghResult.prNumber
    newRequest.prUrl = ghResult.prUrl
    newRequest.commitSha = ghResult.commitSha
    newRequest.workflowRunId = ghResult.workflowRunId
    newRequest.status = "planning"
    newRequest.planRun = {
      generatedPath: generated.generatedPath,
      triggeredAt: new Date().toISOString(),
      workflowUrl: ghResult.workflowRunId
        ? `https://github.com/${OWNER}/${REPO}/actions/runs/${ghResult.workflowRunId}`
        : undefined,
      runId: ghResult.workflowRunId,
    }

    existing.push(newRequest)
    await writeFile(STORAGE_FILE, JSON.stringify(existing, null, 2), "utf8")

    return NextResponse.json({
      success: true,
      requestId,
      plan: newRequest.plan,
      prUrl: newRequest.prUrl,
    })
  } catch (error) {
    console.error("[api/requests] error parsing request:", error)
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Invalid JSON payload"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const contents = await readFile(STORAGE_FILE, "utf8")
    const parsed = JSON.parse(contents)
    let requests: StoredRequest[] = Array.isArray(parsed) ? parsed : []

    const token = await getGitHubAccessToken(req)
    if (token) {
      const updatedRequests: StoredRequest[] = []
      for (const r of requests) {
        let updated = { ...r }

        if (r.prNumber) {
          try {
            const prRes = await gh(token, `/repos/${OWNER}/${REPO}/pulls/${r.prNumber}`)
            const prJson = (await prRes.json()) as { merged?: boolean; state?: string; html_url?: string }
            updated.prUrl = prJson.html_url ?? updated.prUrl
            if (prJson.merged) {
              updated.status = updated.status === "applying" || updated.status === "complete" ? updated.status : "merged"
            } else if (prJson.state === "open" && updated.status === "created") {
              updated.status = "pr_open"
            }
          } catch {
            /* ignore */
          }
        }

        if (!r.workflowRunId && r.branchName && (r.status === "planning" || r.status === "pr_open")) {
          try {
            const runsRes = await gh(
              token,
              `/repos/${OWNER}/${REPO}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(
                r.branchName
              )}&per_page=1`
            )
            const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number; status?: string; conclusion?: string }> }
            const run = runsJson.workflow_runs?.[0]
            if (run?.id) {
              updated.workflowRunId = run.id
            }
            if (run?.conclusion === "success") {
              updated.status = "plan_ready"
            } else if (run?.conclusion === "failure") {
              updated.status = "failed"
            }
          } catch {
            /* ignore */
          }
        }

        if (r.workflowRunId || updated.workflowRunId) {
          try {
            const runId = r.workflowRunId ?? updated.workflowRunId
            if (!runId) throw new Error("no run id")
            const runRes = await gh(token, `/repos/${OWNER}/${REPO}/actions/runs/${runId}`)
            const runJson = (await runRes.json()) as { status?: string; conclusion?: string }
            if (runJson.conclusion === "success") {
              if (updated.status !== "merged" && updated.status !== "applying" && updated.status !== "complete") {
                updated.status = "plan_ready"
              }
            } else if (runJson.conclusion === "failure") {
              updated.status = "failed"
            } else if (runJson.status === "in_progress" || runJson.status === "queued") {
              if (updated.status !== "merged" && updated.status !== "plan_ready") {
                updated.status = "planning"
              }
            }
          } catch {
            /* ignore */
          }
        }

        updatedRequests.push(updated)
      }
      requests = updatedRequests
      await writeFile(STORAGE_FILE, JSON.stringify(requests, null, 2), "utf8")
    }

    return NextResponse.json({
      success: true,
      requests,
    })
  } catch {
    return NextResponse.json({
      success: true,
      requests: [],
    })
  }
}