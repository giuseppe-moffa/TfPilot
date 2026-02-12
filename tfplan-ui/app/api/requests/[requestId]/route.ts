import { NextResponse } from "next/server"

import { getRequest } from "@/lib/storage/requestsStore"

export async function GET(_req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 })
  }

  try {
    const request = await getRequest(requestId)
    if (!request) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ request })
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("[api/requests/[requestId]] error", err)
    return NextResponse.json({ error: "Failed to load request" }, { status: 500 })
  }
}
