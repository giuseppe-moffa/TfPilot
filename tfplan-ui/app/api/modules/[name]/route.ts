import { NextRequest, NextResponse } from "next/server"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { loadModuleMeta } from "../route"

export async function GET(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const moduleName = params.name
    if (!moduleName) {
      return NextResponse.json({ error: "Module name required" }, { status: 400 })
    }
    const metaPath = path.join(process.cwd(), "..", "terraform-modules", moduleName, "metadata.json")
    const exists = await stat(metaPath).then(() => true).catch(() => false)
    if (!exists) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 })
    }
    const meta = await loadModuleMeta(metaPath)
    if (!meta) {
      return NextResponse.json({ error: "Invalid module metadata" }, { status: 500 })
    }
    return NextResponse.json(meta)
  } catch (error) {
    console.error("[api/modules/:name] error", error)
    return NextResponse.json({ error: "Unable to load module metadata" }, { status: 500 })
  }
}
