import { NextRequest, NextResponse } from "next/server"

import { getRequest, saveRequest } from "@/lib/storage/requestsStore"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params

    if (!requestId) {
      return NextResponse.json(
        { success: false, error: "Missing requestId" },
        { status: 400 }
      )
    }

    const existing = await getRequest(requestId).catch(() => null)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const nextTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : []
    nextTimeline.push({
      step: "Approved",
      status: "Complete",
      message: "Request approved and ready for merge",
      at: now,
    })

    const updated = {
      ...existing,
      approval: { approved: true, approvers: existing.approval?.approvers ?? [] },
      status: "approved",
      statusDerivedAt: now,
      updatedAt: now,
      timeline: nextTimeline,
    }

    await saveRequest(updated)

    return NextResponse.json({ success: true, request: updated }, { status: 200 })
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
