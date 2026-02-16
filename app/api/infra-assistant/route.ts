import { NextRequest, NextResponse } from "next/server"

const SYSTEM_PROMPT = `You are an AI Infrastructure Assistant inside a Terraform self-service platform.

CRITICAL: Your response must be ONLY a valid JSON object with NO additional text, markdown, or explanations. Start your response with { and end with }.

Required JSON structure:
{
  "patch": { "field_name": "value" },
  "rationale": ["brief explanation"],
  "clarifications": [],
  "confidence": "high"
}

Rules:
- For known modules with fieldsMeta: ALWAYS return NON-EMPTY patch OR clarifications. Never empty.
- Return ONLY JSON. No text before or after.
- Patch keys must match WRITABLE fieldsMeta names only (exclude readOnly/immutable fields).
- Patch values should be changes from currentInputs (deltas only).
- If unclear, provide safe defaults + clarifications.
- Rationale as short array of strings.`.trim()

type ChatMessage = { role: "user" | "system"; content: string }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: ChatMessage[]
      project?: string
      environment?: string
      module?: string
      fieldsMeta?: Array<{ name: string; type?: string; enum?: string[]; required?: boolean; default?: any }>
      currentInputs?: Record<string, any>
    }

    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 })
    }

    const { env, logEnvDebug } = await import("@/lib/config/env")
    logEnvDebug()
    const apiKey = env.OPENAI_API_KEY
    const model = env.OPENAI_MODEL
    const debugEnabled = process.env.TFPILOT_ASSISTANT_DEBUG === "true"

    const allowedFields = (body.fieldsMeta ?? [])
      .filter((f: any) => !(f.readOnly || f.immutable))
      .map((f: { name: string }) => f.name)
      .filter(Boolean)
    const fieldMetaByName = new Map<string, { name: string; type?: string; enum?: string[]; required?: boolean; default?: any }>(
      (body.fieldsMeta ?? []).map((f) => [f.name, f])
    )
    const hasModule = Boolean(body.module)
    const hasFields = allowedFields.length > 0

    const payload = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(body.project && body.environment
          ? [{ role: "system" as const, content: `Project: ${body.project}\nEnvironment: ${body.environment}` }]
          : []),
        ...(body.module ? [{ role: "system" as const, content: `Module: ${body.module}` }] : []),
        ...(allowedFields.length
          ? [
              {
                role: "system" as const,
                content: `Allowed fields (limit patch keys to this list): ${allowedFields.join(", ")}`,
              },
              {
                role: "system" as const,
                content: `Field metadata: ${JSON.stringify(
                  (body.fieldsMeta ?? []).map((f) => ({
                    name: f.name,
                    type: f.type,
                    enum: f.enum,
                    required: f.required,
                    default: f.default,
                  }))
                )}`,
              },
              {
                role: "system" as const,
                content: `Current inputs: ${JSON.stringify(body.currentInputs ?? {})}`,
              },
            ]
          : []),
        ...body.messages,
      ],
      temperature: 0.3,
    }

    async function callOpenAI(msgs: typeof payload.messages) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...payload, messages: msgs }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "OpenAI error")
        throw new Error(`Failed to call OpenAI: ${errText}`)
      }
      const data = await res.json()
      const raw = data?.choices?.[0]?.message?.content ?? "{}"
      return raw
    }

    let rawContent = await callOpenAI(payload.messages)

    // Debug: log what the AI actually returned
    console.log("[infra-assistant] AI raw response:", rawContent.substring(0, 500) + (rawContent.length > 500 ? "..." : ""))

    function normalizeParsed(input: any, hasModule: boolean, hasFields: boolean) {
      const out: any = {}
      out.rationale = Array.isArray(input?.rationale)
        ? input.rationale.map(String)
        : input?.rationale
          ? [String(input.rationale)]
          : []
      out.confidence = ["low", "medium", "high"].includes(String(input?.confidence ?? "").toLowerCase())
        ? String(input.confidence).toLowerCase()
        : "low"

      // Handle clarifications - convert strings to proper objects
      if (Array.isArray(input?.clarifications)) {
        out.clarifications = input.clarifications.map((c: any, index: number) => {
          if (typeof c === "string") {
            // Convert string clarification to object format
            return {
              id: `clarify_${index}`,
              question: c,
              type: "choice",
              field: c.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 20),
              options: [
                { key: "yes", label: "Yes" },
                { key: "no", label: "No" }
              ],
              patchesByOption: {
                "yes": [{ op: "set", path: `/inputs/${c.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 20)}`, value: true }],
                "no": [{ op: "set", path: `/inputs/${c.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 20)}`, value: false }]
              }
            }
          }
          return c // Already an object, pass through
        })
      } else {
        out.clarifications = []
      }
      out.patch =
        hasModule && hasFields && input?.patch && typeof input.patch === "object" && !Array.isArray(input.patch)
          ? Object.fromEntries(Object.entries(input.patch).filter(([k]) => allowedFields.includes(k)))
          : {}
      return out
    }

    function hasEmptyPatch(obj: any) {
      return !obj.patch || (typeof obj.patch === "object" && Object.keys(obj.patch).length === 0)
    }

    function isEmptyPatchAndClarifications(obj: any) {
      return hasEmptyPatch(obj) && (!Array.isArray(obj.clarifications) || obj.clarifications.length === 0)
    }

    if (hasModule && !hasFields) {
      const assistant_state = {
        patch: {},
        rationale: ["Module schema missing; please reselect the module or retry."],
        clarifications: [
          {
            id: "schema_missing",
            question: "Module schema is not loaded. Please reselect the module and try again.",
            type: "text",
            field: "__system__",
          },
        ],
        confidence: "low",
        action: { kind: "clarification" as const },
      }
      return NextResponse.json({
        role: "assistant",
        content: JSON.stringify(assistant_state),
        assistant_state,
      })
    }

    const attemptParse = (text: string) => {
      // Try to extract JSON from text that might contain extra content
      const trimmed = text.trim()

      // Look for JSON object boundaries
      const jsonStart = trimmed.indexOf('{')
      const jsonEnd = trimmed.lastIndexOf('}')

      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonCandidate = trimmed.substring(jsonStart, jsonEnd + 1)
        try {
          const parsed = JSON.parse(jsonCandidate)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed
          }
        } catch {
          // Fall through to direct parsing
        }
      }

      // Try direct parsing
      try {
        const parsed = JSON.parse(trimmed)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object")
        return parsed
      } catch {
        return null
      }
    }

    let parsed = normalizeParsed(attemptParse(rawContent), hasModule, hasFields)
    const parsedFromJSON = parsed !== null

    console.log("[infra-assistant] parsed.initial", {
      hasModule,
      hasFields,
      patchKeys: Object.keys(parsed.patch ?? {}),
      clarifications: parsed.clarifications?.length ?? 0,
      rationale: parsed.rationale?.length ?? 0,
      parsedType: typeof parsed,
      parsedKeys: Object.keys(parsed || {}),
      parsedFromJSON,
      rawContentLength: rawContent.length,
    })

    function computeDeltaPatch(patchObj: Record<string, any>, current: Record<string, any>) {
      const delta: Record<string, any> = {}
      for (const [k, v] of Object.entries(patchObj ?? {})) {
        if (!allowedFields.includes(k)) continue
        const currVal = current?.[k]
        const same = JSON.stringify(currVal) === JSON.stringify(v)
        if (!same) delta[k] = v
      }
      return delta
    }

    function chooseClarificationField(current: Record<string, any>) {
      const metas = body.fieldsMeta ?? []
      const requiredMissing = metas.find((m) => m.required && current?.[m.name] === undefined && m.default === undefined)
      if (requiredMissing) return requiredMissing
      const enumOrBool = metas.find((m) => (m.type === "boolean" || (Array.isArray(m.enum) && m.enum.length > 0)) && allowedFields.includes(m.name))
      if (enumOrBool) return enumOrBool
      return metas.find((m) => allowedFields.includes(m.name)) ?? null
    }

    // Compute delta patch against current inputs
    const currentInputs = body.currentInputs ?? {}
    parsed.patch = computeDeltaPatch(parsed.patch ?? {}, currentInputs)

    // If AI returned text instead of JSON, extract rationale and generate patches
    if (!parsedFromJSON && hasModule && hasFields) {
      console.log("[infra-assistant] AI returned text instead of JSON, extracting rationale and generating patches")
      // Use the raw text as rationale
      parsed.rationale = [rawContent.trim()]
      parsed.confidence = "medium"

      // Make a second call to generate patches from the text
      const patchGenerationMessages = [
        { role: "system" as const, content: `Based on this user request and the following AI analysis, generate a JSON patch for the Terraform module.

Module: ${body.module || "unknown"}
Available fields: ${allowedFields.join(", ")}
Current inputs: ${JSON.stringify(body.currentInputs ?? {})}

AI Analysis: ${rawContent}

Return ONLY JSON: {"patch": {"field": "value"}, "rationale": ["explanation"]}` },
        ...body.messages,
      ]

      try {
        const patchRaw = await callOpenAI(patchGenerationMessages)
        console.log("[infra-assistant] patch generation response:", patchRaw.substring(0, 300))
        const patchParsed = normalizeParsed(attemptParse(patchRaw), hasModule, hasFields)
        if (patchParsed && Object.keys(patchParsed.patch ?? {}).length > 0) {
          parsed.patch = patchParsed.patch
          if (patchParsed.rationale && patchParsed.rationale.length > 0) {
            parsed.rationale = patchParsed.rationale
          }
        }
      } catch (err) {
        console.warn("[infra-assistant] Failed to generate patches from text:", err)
      }
    }

    if (hasModule && hasFields && isEmptyPatchAndClarifications(parsed)) {
      const strictMessages = [
        ...payload.messages,
        {
          role: "system" as const,
          content:
            "Previous response was invalid (missing delta patch/clarifications). Return JSON with NON-EMPTY delta patch vs currentInputs or field-bound clarifications. Do not return empty or ambiguous.",
        },
      ]
      const secondRaw = await callOpenAI(strictMessages)
      parsed = normalizeParsed(attemptParse(secondRaw), hasModule, hasFields)
      parsed.patch = computeDeltaPatch(parsed.patch ?? {}, currentInputs)
      if (debugEnabled) {
        console.info("[infra-assistant] parsed.afterRetry", {
          patchKeys: Object.keys(parsed.patch ?? {}),
          clarifications: parsed.clarifications?.length ?? 0,
        })
      }
    }

    // Final fallback: if we still have no patches or clarifications, generate basic clarifications
    if (hasModule && hasFields && isEmptyPatchAndClarifications(parsed)) {
      console.log("[infra-assistant] Final fallback: generating clarifications since no patches available")
      const chosen = chooseClarificationField(currentInputs)
      if (chosen) {
        const options =
          chosen.type === "boolean"
            ? [
                { key: "yes", label: "Yes" },
                { key: "no", label: "No" },
              ]
            : Array.isArray(chosen.enum) && chosen.enum.length > 0
              ? chosen.enum.map((v) => ({ key: v, label: v }))
              : undefined
        parsed.clarifications = parsed.clarifications ?? []
        parsed.clarifications.push({
          id: `clarify_${chosen.name}`,
          question: `Provide a value for ${chosen.name}`,
          type: options ? "choice" : chosen.type === "boolean" ? "boolean" : "text",
          field: chosen.name,
          options,
          patchesByOption: options
            ? Object.fromEntries(
                options.map((o) => [
                  o.key,
                  [{ op: "set", path: `/inputs/${chosen.name}`, value: o.key === "yes" ? true : o.key === "no" ? false : o.key }],
                ])
              )
            : undefined,
          patchesFromText: options ? undefined : { path: `/inputs/${chosen.name}`, op: "set" },
        })
      } else {
        // No writable fields; return a system clarification
        parsed.clarifications = parsed.clarifications ?? []
        parsed.clarifications.push({
          id: "no_writable_fields",
          question: "Module schema is present but no writable fields are available. Please retry after schema refresh.",
          type: "text",
          field: "__system__",
        })
      }
    }

    const assistant_state = {
      patch: parsed.patch ?? {},
      rationale: parsed.rationale ?? [],
      clarifications: parsed.clarifications ?? [],
      confidence: parsed.confidence ?? "low",
      action: { kind: Object.keys(parsed.patch ?? {}).length > 0 ? ("patch" as const) : ("clarification" as const) },
    }

    console.log("[infra-assistant] final assistant_state", {
      patchKeys: Object.keys(assistant_state.patch),
      rationaleCount: assistant_state.rationale.length,
      clarificationsCount: assistant_state.clarifications.length,
      hasPatch: Object.keys(assistant_state.patch).length > 0,
      hasClarifications: assistant_state.clarifications.length > 0,
    })

    return NextResponse.json({
      role: "assistant",
      content: JSON.stringify(assistant_state),
      assistant_state,
    })
  } catch (error) {
    console.error("[api/infra-assistant] error", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
