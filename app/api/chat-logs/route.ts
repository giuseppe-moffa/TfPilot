import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

import { env } from "@/lib/config/env"

type ChatLogEntry = {
  timestamp: string
  project?: string
  environment?: string
  module?: string
  messages: Array<{ role: string; content: string }>
}

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_CHAT_LOGS_BUCKET
const PREFIX = "logs/"

async function appendLog(entry: ChatLogEntry) {
  const key = `${PREFIX}${entry.timestamp}-${randomUUID()}.json`
  const body = JSON.stringify(entry, null, 2)
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return { key }
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
    const result = await appendLog(entry)
    return NextResponse.json({ ok: true, key: result.key })
  } catch (error) {
    console.error("[api/chat-logs] error", error)
    return NextResponse.json({ error: "failed to write log" }, { status: 500 })
  }
}
