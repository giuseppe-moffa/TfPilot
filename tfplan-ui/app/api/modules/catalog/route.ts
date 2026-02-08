import { NextRequest, NextResponse } from "next/server"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

type ModuleInput = {
  name: string
  type: string
  default?: unknown
  description?: string
}

type ModuleMeta = {
  name: string
  description: string
  inputs: ModuleInput[]
  category: string
}

type CachedCatalog = {
  timestamp: number
  modules: ModuleMeta[]
}

let cache: CachedCatalog | null = null

const MODULES_DIR = path.join(process.cwd(), "..", "terraform-modules")
const CACHE_TTL_MS = 60 * 1000

async function loadModuleMeta(metaPath: string): Promise<ModuleMeta | null> {
  try {
    const data = await readFile(metaPath, "utf8")
    const parsed = JSON.parse(data) as ModuleMeta
    if (!parsed?.name || !parsed?.description || !Array.isArray(parsed?.inputs) || !parsed?.category) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function walkModules(dir: string): Promise<ModuleMeta[]> {
  const entries = await stat(dir).then(() => import("node:fs/promises").then((fs) => fs.readdir(dir)))
  const modules: ModuleMeta[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry)
    const metaPath = path.join(full, "metadata.json")
    try {
      const stats = await stat(metaPath)
      if (stats.isFile()) {
        const meta = await loadModuleMeta(metaPath)
        if (meta) modules.push(meta)
      }
    } catch {
      // ignore missing metadata.json
    }
  }

  return modules
}

async function getCatalog(forceRefresh: boolean): Promise<ModuleMeta[]> {
  const now = Date.now()
  if (!forceRefresh && cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.modules
  }

  const modules = await walkModules(MODULES_DIR)
  cache = { timestamp: now, modules }
  return modules
}

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "true"
    const modules = await getCatalog(refresh)
    return NextResponse.json({ modules })
  } catch (error) {
    console.error("[api/modules/catalog] error", error)
    return NextResponse.json({ error: "Unable to load module catalog" }, { status: 500 })
  }
}
