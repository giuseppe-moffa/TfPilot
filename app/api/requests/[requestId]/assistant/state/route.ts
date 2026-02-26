import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { ensureAssistantState, validateClarifications, validateSuggestions, computeSuggestionId, computeSuggestionsHash } from "@/lib/assistant/state"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    const body = (await req.json()) as {
      suggestions?: any[]
      clarifications?: any[]
      hash?: string | null
    }

    const baseRequest = ensureAssistantState(await getRequest(requestId))

    const suggestions = validateSuggestions((body.suggestions ?? []) as any[])
    const clarifications = validateClarifications((body.clarifications ?? []) as any[])

    const suggestionsWithIds = suggestions.map((s) => ({
      ...s,
      id: computeSuggestionId(s.patch),
    }))

    const computedHash = computeSuggestionsHash({
      moduleKey: baseRequest.module,
      normalizedInputs: baseRequest.config,
      registryVersion: baseRequest.registryRef?.commitSha ?? null,
      suggestions: suggestionsWithIds.map((s) => ({ patch: s.patch })),
      clarifications: clarifications.map((c) => ({
        id: c.id,
        options: c.options,
        patchesByOption: c.patchesByOption,
        patchesFromText: c.patchesFromText,
      })),
    })

    if (body.hash && body.hash !== computedHash) {
      return NextResponse.json({ success: false, error: "Hash mismatch" }, { status: 400 })
    }

    if (baseRequest.assistant_state.last_suggestions_hash === computedHash) {
      return NextResponse.json({ success: true, request: baseRequest }, { status: 200 })
    }

    const [updated] = await updateRequest(requestId, (current) => {
      const withAssistant = ensureAssistantState(current)
      return {
        ...withAssistant,
        assistant_state: {
          ...withAssistant.assistant_state,
          suggestions: suggestionsWithIds,
          clarifications,
          last_suggestions_hash: computedHash,
          clarifications_resolved: withAssistant.assistant_state.clarifications_resolved ?? {},
        },
        updatedAt: new Date().toISOString(),
      }
    })

    return NextResponse.json({ success: true, request: updated }, { status: 200 })
  } catch (err) {
    console.error("[assistant/state] error", err)
    return NextResponse.json({ success: false, error: "Failed to store assistant state" }, { status: 400 })
  }
}
