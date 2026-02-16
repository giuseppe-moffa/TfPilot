import { NextRequest, NextResponse } from "next/server"

import { listRequests } from "@/lib/storage/requestsStore"

export async function GET(_req: NextRequest) {
  try {
    // Get all requests (with higher limit for drift checking)
    const allRequests = await listRequests(500)

    // Filter for eligible dev requests
    const eligible = allRequests.filter((request: any) => {
      // Must be dev environment
      if (request.environment?.toLowerCase() !== "dev") {
        return false
      }

      // Must be successfully applied (status complete or applyRun success)
      const isComplete =
        request.status === "complete" ||
        (request.applyRun?.conclusion === "success" && request.status !== "destroyed")

      if (!isComplete) {
        return false
      }

      // Must not be destroyed/archived
      if (request.status === "destroyed" || request.status === "destroying") {
        return false
      }

      // Must not be currently planning/applying/destroying
      const isActive =
        request.planRun?.status === "in_progress" ||
        request.planRun?.status === "queued" ||
        request.applyRun?.status === "in_progress" ||
        request.applyRun?.status === "queued" ||
        request.status === "planning" ||
        request.status === "applying"

      if (isActive) {
        return false
      }

      return true
    })

    // Return minimal metadata for workflow dispatch
    const result = eligible.map((request: any) => ({
      id: request.id,
      project: request.project,
      environment: request.environment,
      targetOwner: request.targetOwner,
      targetRepo: request.targetRepo,
    }))

    return NextResponse.json({
      success: true,
      requests: result,
      count: result.length,
    })
  } catch (error) {
    console.error("[api/requests/drift-eligible] error", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to enumerate eligible requests",
        requests: [],
        count: 0,
      },
      { status: 500 }
    )
  }
}
