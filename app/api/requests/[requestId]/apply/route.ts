import { NextRequest, NextResponse } from "next/server"

import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"

export async function POST(_req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await context.params

    if (!requestId) {
      return NextResponse.json(
        { success: false, error: "Missing requestId" },
        { status: 400 }
      )
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    const existing = await getRequest(requestId).catch(() => null)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }

    const nextTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : []

    nextTimeline.push({
      step: "Applied",
      status: "Complete",
      message: "Changes have been applied",
      at: new Date().toISOString(),
    })

    const updated = await updateRequest(requestId, (current) => ({
      ...current,
      status: "applied",
      updatedAt: new Date().toISOString(),
      appliedAt: new Date().toISOString(),
      timeline: nextTimeline,
    }))

    return NextResponse.json({ success: true, request: updated }, { status: 200 })
  } catch (error) {
    console.error("[api/requests/apply] error", error)
    return NextResponse.json(
      { success: false, error: "Failed to apply request" },
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
