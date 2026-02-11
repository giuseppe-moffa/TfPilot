import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"

const STORAGE_DIR = path.join(process.cwd(), "tmp")
const STORAGE_FILE = path.join(STORAGE_DIR, "requests.json")

export async function POST(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params

    if (!requestId) {
      return NextResponse.json(
        { success: false, error: "Missing requestId" },
        { status: 400 }
      )
    }

    await mkdir(STORAGE_DIR, { recursive: true })
    const contents = await readFile(STORAGE_FILE, "utf8").catch(() => "[]")
    const parsed = JSON.parse(contents)
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: "Invalid storage format" },
        { status: 500 }
      )
    }

    const idx = parsed.findIndex((r: { id: string }) => r.id === requestId)
    if (idx === -1) {
      return NextResponse.json(
        { success: false, error: "Request not found" },
        { status: 404 }
      )
    }

    const existing = parsed[idx] ?? {}
    const nextTimeline = Array.isArray(existing.timeline)
      ? [...existing.timeline]
      : []

    nextTimeline.push({
      step: "Approved",
      status: "Complete",
      message: "Request approved and ready for merge",
      at: new Date().toISOString(),
    })

    parsed[idx] = {
      ...parsed[idx],
      status: "approved",
      updatedAt: new Date().toISOString(),
      pr: {
        url: "https://github.com/infraforge/infraforge-iac/pull/123",
        branch: `req-${requestId}`,
        status: "open",
      },
      timeline: nextTimeline,
    }

    await writeFile(STORAGE_FILE, JSON.stringify(parsed, null, 2), "utf8")

    return NextResponse.json(
      { success: true, request: parsed[idx] },
      { status: 200 }
    )
  } catch (error) {
    console.error("[api/requests/approve] error", error)
    return NextResponse.json(
      { success: false, error: "Failed to approve request" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  )
}
