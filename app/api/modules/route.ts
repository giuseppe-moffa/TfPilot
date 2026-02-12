import { NextResponse } from "next/server"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

type ModuleInput = {
  name: string
  type: string
  description?: string
  default?: unknown
  required?: boolean
  advanced?: boolean
  fields?: ModuleInput[]
}

type ModuleMeta = {
  name: string
  description: string
  category?: string
  inputs: ModuleInput[]
}

type CachedCatalog = {
  timestamp: number
  modules: ModuleMeta[]
}

const MODULES_DIR = path.join(process.cwd(), "..", "terraform-modules")
const CACHE_TTL_MS = 60 * 1000
let cache: CachedCatalog | null = null

function isValidInput(input: ModuleInput): boolean {
  return Boolean(input.name && input.type)
}

function validateMeta(meta: ModuleMeta): boolean {
  if (!meta?.name || !meta?.description || !Array.isArray(meta.inputs)) return false
  return meta.inputs.every(isValidInput)
}

async function loadModuleMeta(metaPath: string): Promise<ModuleMeta | null> {
  try {
    const raw = await readFile(metaPath, "utf8")
    const parsed = JSON.parse(raw) as ModuleMeta
    if (!validateMeta(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export { loadModuleMeta }

async function loadModules(): Promise<ModuleMeta[]> {
  try {
    const entries = await readdir(MODULES_DIR)
    const mods: ModuleMeta[] = []
    for (const entry of entries) {
      const full = path.join(MODULES_DIR, entry)
      const metaPath = path.join(full, "metadata.json")
      try {
        const metaStat = await stat(metaPath)
        if (metaStat.isFile()) {
          const meta = await loadModuleMeta(metaPath)
          if (meta) mods.push(meta)
        }
      } catch {
        // skip missing/invalid
      }
    }
    return mods
  } catch {
    return []
  }
}

async function getCatalog(forceRefresh: boolean) {
  const now = Date.now()
  if (!forceRefresh && cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.modules
  }
  const mods = await loadModules()
  cache = { timestamp: now, modules: mods }
  return mods
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const refresh = url.searchParams.get("refresh") === "true"
    const mods = await getCatalog(refresh)
    const summary = mods.map(({ name, description, category }) => ({ name, description, category }))
    return NextResponse.json({ modules: summary })
  } catch (error) {
    console.error("[api/modules] error", error)
    return NextResponse.json({ error: "Unable to load modules" }, { status: 500 })
  }
}
