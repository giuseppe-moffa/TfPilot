import { type FieldMeta } from "@/components/assistant-helper"

export type AssistantMode = "suggest" | "ask"

export type AssistantResponse = {
  patch?: Record<string, unknown>
  rationale?: string | string[]
  questions?: Array<string | { id?: string; text: string; field?: string; options?: Array<{ label: string; value: any }> }>
  confidence?: string
}

export type ChatMessage =
  | { id: string; ts: number; role: "user" | "assistant" | "system"; kind: "text"; content: string }
  | { id: string; ts: number; role: "assistant"; kind: "suggestion"; title: string; superseded?: boolean }
  | { id: string; ts: number; role: "assistant"; kind: "question"; questionId: string; text: string; field: string; options: { label: string; value: any }[] }
  | { id: string; ts: number; role: "system"; kind: "notice"; content: string }

type NormalizeCtx = {
  mode: AssistantMode
  response: AssistantResponse | null
  fieldsMeta?: FieldMeta[]
  now?: number
}

function toListMarkdown(rationale?: string | string[]): string | null {
  if (!rationale) return null
  if (Array.isArray(rationale)) {
    if (rationale.length === 0) return null
    return rationale.map((r) => `- ${r}`).join("\n")
  }
  return rationale
}

function hasPatch(resp?: AssistantResponse | null) {
  return resp?.patch && Object.keys(resp.patch).length > 0
}

function normalizeQuestions(
  questions: AssistantResponse["questions"],
  mode: AssistantMode
): ChatMessage[] {
  if (!questions || questions.length === 0) return []
  if (mode === "ask") {
    // Render as plain text in ask mode
    return questions
      .map((q) => {
        const text = typeof q === "string" ? q : q.text
        return text
          ? ({
              id: crypto.randomUUID(),
              ts: Date.now(),
              role: "assistant",
              kind: "text",
              content: text,
            } satisfies ChatMessage)
          : null
      })
      .filter(Boolean) as ChatMessage[]
  }

  return questions
    .map((q) => {
      if (typeof q === "string") {
        return {
          id: crypto.randomUUID(),
          ts: Date.now(),
          role: "assistant",
          kind: "question",
          questionId: crypto.randomUUID(),
          text: q,
          field: q.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          options: [
            { label: "Yes", value: true },
            { label: "No", value: false },
          ],
        } satisfies ChatMessage
      }
      const options =
        q.options && q.options.length
          ? q.options
          : [
              { label: "Yes", value: true },
              { label: "No", value: false },
            ]
      return {
        id: crypto.randomUUID(),
        ts: Date.now(),
        role: "assistant",
        kind: "question",
        questionId: q.id ?? crypto.randomUUID(),
        text: q.text,
        field: q.field ?? q.text.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        options,
      } satisfies ChatMessage
    })
    .filter(Boolean) as ChatMessage[]
}

export function normalizeAssistantResponse({ mode, response, fieldsMeta, now }: NormalizeCtx): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (!response) {
    messages.push({
      id: crypto.randomUUID(),
      ts: now ?? Date.now(),
      role: "system",
      kind: "notice",
      content: "Assistant response could not be parsed.",
    })
    return messages
  }

  // Explanation
  const markdown = toListMarkdown(response.rationale)
  if (markdown) {
    messages.push({
      id: crypto.randomUUID(),
      ts: now ?? Date.now(),
      role: "assistant",
      kind: "text",
      content: markdown,
    })
  }

  // Suggestion card
  if (mode === "suggest" && hasPatch(response)) {
    messages.push({
      id: crypto.randomUUID(),
      ts: now ?? Date.now(),
      role: "assistant",
      kind: "suggestion",
      title: "Suggested changes",
    })
  } else if (mode === "ask" && hasPatch(response)) {
    messages.push({
      id: crypto.randomUUID(),
      ts: now ?? Date.now(),
      role: "system",
      kind: "notice",
      content: "Suggestion ignored in Ask mode.",
    })
  }

  // Questions
  messages.push(...normalizeQuestions(response.questions, mode))

  return messages
}
