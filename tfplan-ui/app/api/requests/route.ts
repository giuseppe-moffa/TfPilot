import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

import { mockRequests as seedRequests } from "@/lib/data/mock-requests"
import { createDraftPullRequest, triggerPlanWorkflow } from "@/lib/github/mock"

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
  status: "pending" | "planned" | "approved" | "applied"
  plan?: {
    diff: string
  }
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
      status: r.status,
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestPayload
    const errors = validatePayload(body)

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      )
    }

    const requestId = `req_${randomBytes(3).toString("hex").toUpperCase()}`

    console.log("[api/requests] received payload:", body)
    console.log("[api/requests] Triggering generation for", requestId)
    console.log("[api/requests] config.name =", body.config?.name)

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
      status: "pending",
      plan: { diff: planDiffForModule(body.module) },
      pullRequest: await createDraftPullRequest({
        requestId,
        module: body.module,
      }),
    }

    existing.push(newRequest)
    await writeFile(STORAGE_FILE, JSON.stringify(existing, null, 2), "utf8")

    // simulate async plan generation: update stored record to planned with plan
    setTimeout(async () => {
      try {
        const latestRaw = await readFile(STORAGE_FILE, "utf8").catch(() => "[]")
        const latest = JSON.parse(latestRaw)
        if (!Array.isArray(latest)) return
        const idx = latest.findIndex((r: StoredRequest) => r.id === requestId)
        if (idx === -1) return
        await triggerPlanWorkflow(latest[idx]?.pullRequest?.branch ?? "")
        latest[idx] = {
          ...latest[idx],
          status: "planned",
          updatedAt: new Date().toISOString(),
          plan: { diff: planDiffForModule(body.module) },
        }
        await writeFile(STORAGE_FILE, JSON.stringify(latest, null, 2), "utf8")
        console.log("[api/requests] Plan ready for", requestId)
      } catch (err) {
        console.warn("[api/requests] failed to update plan for", requestId, err)
      }
    }, 3000)

    return NextResponse.json({
      success: true,
      requestId,
      plan: newRequest.plan,
      pullRequest: newRequest.pullRequest,
    })
  } catch (error) {
    console.error("[api/requests] error parsing request:", error)
    return NextResponse.json(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 }
    )
  }
}

export async function GET() {
  try {
    const contents = await readFile(STORAGE_FILE, "utf8")
    const parsed = JSON.parse(contents)
    const requests = Array.isArray(parsed) ? parsed : []
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