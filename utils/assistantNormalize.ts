import { type FieldMeta } from "@/components/assistant-helper"

export type AssistantMode = "suggest" | "ask"

export type AssistantClarification = {
  id?: string
  question: string
  type?: "choice" | "text" | "boolean"
  field?: string
  options?: Array<{ key: string; label: string; value?: any }>
  patchesByOption?: Record<string, Array<{ op: "set" | "unset"; path: string; value?: any }>>
  patchesFromText?: { path: string; op: "set" }
}

export type AssistantResponse = {
  patch?: Record<string, unknown>
  rationale?: string | string[]
  questions?: Array<string | { id?: string; text: string; field?: string; options?: Array<{ label: string; value: any }> }>
  clarifications?: AssistantClarification[]
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

function normalizeQuestions(
  questions: AssistantResponse["questions"],
  clarifications: AssistantResponse["clarifications"],
  mode: AssistantMode
): ChatMessage[] {
  const qList = questions ?? []
  const cList = clarifications ?? []
  if (qList.length === 0 && cList.length === 0) return []
  if (mode === "ask") {
    // Render as plain text in ask mode
    return qList
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

  const extra = cList
    .map((c) => {
      const options =
        c.options?.map((o) => ({ label: o.label ?? o.key, value: o.value ?? (o.key === "yes" ? true : o.key === "no" ? false : o.key) })) ??
        [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ]
      return {
        id: crypto.randomUUID(),
        ts: Date.now(),
        role: "assistant",
        kind: "question",
        questionId: c.id ?? crypto.randomUUID(),
        text: c.question,
        field: c.field ?? c.question.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        options,
      } satisfies ChatMessage
    })
    .filter(Boolean) as ChatMessage[]

  const normalizedQuestions = qList
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

  return [...normalizedQuestions, ...(extra ?? [])]
}

export function normalizeAssistantResponse({ mode, response, fieldsMeta: _fieldsMeta, now }: NormalizeCtx): ChatMessage[] {
  const safe: Required<AssistantResponse> = {
    patch: response?.patch && typeof response.patch === "object" ? response.patch : {},
    rationale: Array.isArray(response?.rationale)
      ? (response?.rationale ?? []).map(String)
      : response?.rationale
        ? [String(response.rationale)]
        : [],
    questions:
      (response?.questions ?? []).map((q) =>
        typeof q === "string"
          ? q
          : {
              id: q?.id,
              text: q?.text ?? "",
              field: q?.field,
              options: (q?.options ?? []).map((o) => ({ label: o.label, value: o.value })),
            }
      ) ?? [],
    clarifications:
      (response?.clarifications ?? []).map((c) => ({
        id: c?.id,
        question: c?.question ?? "",
        type: c?.type ?? "text",
        field: c?.field,
        options: (c?.options ?? []).map((o) => ({ key: o.key, label: o.label, value: o.value })),
        patchesByOption: c?.patchesByOption ?? {},
        patchesFromText: c?.patchesFromText,
      })) ?? [],
    confidence: (() => {
      const val = String(response?.confidence ?? "").toLowerCase()
      if (val === "high" || val === "medium" || val === "low") return val
      return "low"
    })(),
  }

  const messages: ChatMessage[] = []

  const markdown = toListMarkdown(safe.rationale)
  if (markdown) {
    messages.push({
      id: crypto.randomUUID(),
      ts: now ?? Date.now(),
      role: "assistant",
      kind: "text",
      content: markdown,
    })
  }

  messages.push(...normalizeQuestions(safe.questions, safe.clarifications, mode))

  return messages
}
