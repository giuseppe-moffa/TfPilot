import { NextRequest, NextResponse } from "next/server"

const SYSTEM_PROMPT = `
You are an AI Infrastructure Assistant inside a Terraform self-service platform.
Help developers create infrastructure requests without needing to understand Terraform.
Use friendly, simple questions. Ask what they want to build and walk them through step-by-step.
Use existing module metadata to guide decisions.

If MODE=INTERVIEW and MODULE_SELECTED are present in user/system context:
- Immediately ask one simple question that maps to the first required input from MODULE_METADATA.
- Only ask one question at a time, and only for required inputs.
- Do NOT reply with filler like "Okay, let's continue." or "Great".
- Stay concise and specific to the required fields.

When all required inputs are collected, respond ONLY with a JSON object:
{
  "type": "confirmation",
  "summary": "<short formatted summary>",
  "project": "...",
  "environment": "...",
  "module": "...",
  "config": { ...inputs... }
}
Do NOT ask for yes/no. The UI will handle confirmation.
`.trim()

type ChatMessage = { role: "user" | "system"; content: string }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: ChatMessage[]
      project?: string
      environment?: string
    }

    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 })
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-3.5-turbo"

    const payload = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(body.project && body.environment
          ? [{ role: "system" as const, content: `Project: ${body.project}\nEnvironment: ${body.environment}` }]
          : []),
        ...body.messages,
      ],
      temperature: 0.3,
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "OpenAI error")
      return NextResponse.json({ error: "Failed to call OpenAI", detail: errText }, { status: 500 })
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response."

    return NextResponse.json({ role: "assistant", content })
  } catch (error) {
    console.error("[api/infra-assistant] error", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
