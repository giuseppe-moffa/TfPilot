import { NextRequest, NextResponse } from "next/server"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const LOG_DIR = path.join(process.cwd(), "tmp")
const LOG_FILE = path.join(LOG_DIR, "chat-logs.json")

type ChatLogEntry = {
  timestamp: string
  project?: string
  environment?: string
  module?: string
  messages: Array<{ role: string; content: string }>
}

async function appendLog(entry: ChatLogEntry) {
  await mkdir(LOG_DIR, { recursive: true })
  let existing: ChatLogEntry[] = []
  try {
    const raw = await readFile(LOG_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) existing = parsed
  } catch {
    existing = []
  }
  existing.push(entry)
  await writeFile(LOG_FILE, JSON.stringify(existing, null, 2), "utf8")
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ChatLogEntry>
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages required" }, { status: 400 })
    }
    const entry: ChatLogEntry = {
      timestamp: new Date().toISOString(),
      project: body.project,
      environment: body.environment,
      module: body.module,
      messages: body.messages,
    }
    await appendLog(entry)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[api/chat-logs] error", error)
    return NextResponse.json({ error: "failed to write log" }, { status: 500 })
  }
}
