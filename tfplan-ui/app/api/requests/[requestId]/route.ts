import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

const STORAGE_FILE = path.join(process.cwd(), "tmp", "requests.json")

export async function GET(req: NextRequest, { params }: { params: { requestId: string } }) {
  const { requestId } = params
  try {
    const contents = await readFile(STORAGE_FILE, "utf8")
    const parsed = JSON.parse(contents)
    const requests = Array.isArray(parsed) ? parsed : []
    const found = requests.find((r: any) => r.id === requestId)
    if (!found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ request: found })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
