"use client"

import * as React from "react"
import { Loader2, Send } from "lucide-react"
import ReactMarkdown from "react-markdown"

import { normalizeAssistantResponse, type ChatMessage, type AssistantResponse, type AssistantMode as NormalizedAssistantMode } from "@/utils/assistantNormalize"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export type FieldMeta = {
  name: string
  type?: "string" | "number" | "boolean" | "map" | "list" | "enum"
  risk_level?: "low" | "medium" | "high"
  immutable?: boolean
  readOnly?: boolean
}

type AssistantHelperProps = {
  context: {
    project?: string
    environment?: string
    module?: string
    policyHint?: string
    currentValues?: Record<string, unknown>
    fieldsMeta?: FieldMeta[]
  }
  onApplyPatch: (patch: Record<string, unknown>) => void
  onScrollToField?: (field: string) => void
  mode?: AssistantMode
  onModeChange?: (mode: AssistantMode) => void
}

type AssistantMode = NormalizedAssistantMode

function parseJsonObject(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function groupAssistantText(messages: ChatMessage[]): ChatMessage[] {
  const grouped: ChatMessage[] = []
  for (const msg of messages) {
    if (msg.kind === "text" && msg.role === "assistant") {
      const last = grouped[grouped.length - 1]
      if (last && last.kind === "text" && last.role === "assistant") {
        grouped[grouped.length - 1] = {
          ...last,
          content: `${last.content}\n${msg.content}`,
          ts: msg.ts,
        }
        continue
      }
    }
    grouped.push(msg)
  }
  return grouped
}

export function AssistantHelper({ context, onApplyPatch, onScrollToField, mode, onModeChange }: AssistantHelperProps) {
  const [internalMode, setInternalMode] = React.useState<AssistantMode>("suggest")
  const assistantMode = mode ?? internalMode
  const setAssistantMode = onModeChange ?? setInternalMode
  const [prompt, setPrompt] = React.useState("")
  const [patch, setPatch] = React.useState<Record<string, unknown> | null>(null)
  const [selectedKeys, setSelectedKeys] = React.useState<Record<string, boolean>>({})
  const [rationale, setRationale] = React.useState<string[] | null>(null)
  const [questions, setQuestions] = React.useState<string[] | null>(null)
  const [confidence, setConfidence] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showRaw, setShowRaw] = React.useState(false)
  const [appliedMsg, setAppliedMsg] = React.useState<string | null>(null)
  const [ignoredNotice, setIgnoredNotice] = React.useState<string | null>(null)
  const [askNotice, setAskNotice] = React.useState<string | null>(null)
  const [suggestMessages, setSuggestMessages] = React.useState<ChatMessage[]>([])
  const [askMessages, setAskMessages] = React.useState<ChatMessage[]>([])
  const [isAtBottom, setIsAtBottom] = React.useState(true)
  const [followUpDrafts, setFollowUpDrafts] = React.useState<Record<string, string>>({})
  const sendChatLog = React.useCallback(
    async (messages: Array<{ role: string; content: string }>) => {
      try {
        await fetch("/api/chat-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: context.project,
            environment: context.environment,
            module: context.module,
            messages,
          }),
        })
      } catch (err) {
        // non-blocking
        // eslint-disable-next-line no-console
        console.warn("[assistant-helper] failed to write chat log", err)
      }
    },
    [context.project, context.environment, context.module]
  )

  const allowedFields = React.useMemo(() => {
    const names = context.fieldsMeta?.map((f) => f.name) ?? Object.keys(context.currentValues ?? {})
    return names.filter((n) => {
      const meta = context.fieldsMeta?.find((f) => f.name === n)
      return !(meta?.readOnly || meta?.immutable)
    })
  }, [context.fieldsMeta, context.currentValues])

  const fieldMetaByName = React.useMemo(() => {
    const map: Record<string, FieldMeta> = {}
    for (const f of context.fieldsMeta ?? []) {
      map[f.name] = f
    }
    return map
  }, [context.fieldsMeta])

  const systemPrompt = React.useMemo(() => {
    const allowedList = allowedFields.join(", ")
    const base = [
      "You are an assistant that suggests JSON patches for Terraform request config.",
      'Return STRICT JSON with shape: { "patch": { ...changedKeysOnly }, "rationale": [..], "questions": [..], "confidence": "High|Medium|Low" }.',
      "Use only the allowed fields; do not include unknown keys.",
      "Do not call any APIs; do not submit requests; only suggest patches.",
      allowedList ? `Allowed fields: ${allowedList}` : "",
      context.policyHint ? `Policy: ${context.policyHint}` : "",
      context.module ? `Module: ${context.module}` : "",
      context.project ? `Project: ${context.project}` : "",
      context.environment ? `Environment: ${context.environment}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    const currentValues = context.currentValues ? `Current values: ${JSON.stringify(context.currentValues)}` : ""
    return [base, currentValues].filter(Boolean).join("\n\n")
  }, [allowedFields, context])

  const handleAsk = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setPatch(null)
    setSelectedKeys({})
    setRationale(null)
    setQuestions(null)
    setConfidence(null)
    setAppliedMsg(null)
    setIgnoredNotice(null)
    setAskNotice(null)
    try {
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ]
      const res = await fetch("/api/infra-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, project: context.project, environment: context.environment }),
      })
      if (!res.ok) throw new Error("Assistant request failed")
      const data = await res.json()
      const content: string = data?.content ?? data?.message?.content ?? ""
      const parsed = parseJsonObject(content) as AssistantResponse | null
      const normalized = normalizeAssistantResponse({
        mode: assistantMode,
        response: parsed,
        fieldsMeta: context.fieldsMeta,
      })
      if (assistantMode === "ask") {
        setAskMessages((prev) => groupAssistantText([...prev, ...normalized]))
        setPatch(null)
        setSelectedKeys({})
        setRationale(null)
        setQuestions(null)
        setConfidence(null)
        const hasPatch = parsed?.patch && Object.keys(parsed.patch).length > 0
        if (hasPatch) setAskNotice("Suggestion ignored in Ask mode.")
        await sendChatLog([
          { role: "user", content: prompt },
          { role: "assistant", content: String(content ?? "") },
        ])
      } else {
        let nextPatch: Record<string, unknown> | null = null
        const ignored: string[] = []
        if (parsed?.patch && Object.keys(parsed.patch).length > 0) {
          const filtered: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(parsed.patch)) {
            if (allowedFields.length === 0 || allowedFields.includes(k)) {
              filtered[k] = v
            } else {
              ignored.push(k)
            }
          }
          nextPatch = filtered
          const toggles: Record<string, boolean> = {}
          for (const key of Object.keys(filtered)) toggles[key] = true
          setSelectedKeys(toggles)
        }
        if (ignored.length > 0) {
          normalized.push({
            id: crypto.randomUUID(),
            ts: Date.now(),
            role: "system",
            kind: "notice",
            content: "Some suggestions were ignored (invalid/immutable).",
          })
        }
        setPatch(nextPatch)
        setSuggestMessages((prev) => {
          const withSupersede = nextPatch
            ? prev.map((m) => (m.kind === "suggestion" ? { ...m, superseded: true } : m))
            : prev
          return groupAssistantText([...withSupersede, ...normalized])
        })
        setRationale(Array.isArray(parsed?.rationale) ? parsed?.rationale.map(String) : null)
        setQuestions(Array.isArray(parsed?.questions) ? parsed?.questions.map(String) : null)
        setConfidence(typeof parsed?.confidence === "string" ? parsed?.confidence : null)
        await sendChatLog([
          { role: "user", content: prompt },
          { role: "assistant", content: String(content ?? "") },
        ])
      }
    } catch (err: any) {
      setError(err?.message || "Failed to ask assistant")
    } finally {
      setLoading(false)
    }
  }

  const diffs = React.useMemo(() => {
    if (!patch) return []
    const current = context.currentValues ?? {}
    return Object.entries(patch).flatMap(([k, v]) => {
      const currentVal = current[k]
      if (currentVal === v) return []
      return [{ key: k, from: currentVal, to: v }]
    })
  }, [patch, context.currentValues])

  const riskBadge = (key: string) => {
    const meta = context.fieldsMeta?.find((f) => f.name === key)
    if (meta?.risk_level === "high") return "High risk change"
    if (meta?.risk_level === "medium") return "Review recommended"
    return null
  }

  const applySelected = () => {
    if (!patch) return
    const selectedPatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (selectedKeys[k]) selectedPatch[k] = v
    }
    onApplyPatch(selectedPatch)
    setAppliedMsg("✅ Suggestions applied — review form")
    const first = Object.keys(selectedPatch)[0]
    if (first && onScrollToField) onScrollToField(first)
    setSuggestMessages((prev) =>
      groupAssistantText([
        ...prev,
        { id: crypto.randomUUID(), ts: Date.now(), role: "system", kind: "notice", content: "Suggestions applied — review form" },
      ])
    )
  }

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleFollowUp = (text: string, value: boolean | number) => {
    if (assistantMode === "ask") {
      setAskNotice("Suggestion ignored in Ask mode.")
      setAskMessages((prev) =>
        groupAssistantText([
          ...prev,
          { id: crypto.randomUUID(), ts: Date.now(), role: "user", kind: "text", content: value ? "Yes" : "No" },
          { id: crypto.randomUUID(), ts: Date.now(), role: "system", kind: "notice", content: "Suggestion ignored in Ask mode." },
        ])
      )
      return
    }
    const slug = slugify(text)
    if (!slug) return
    const meta = context.fieldsMeta?.find((f) => f.name === slug)
    if (!meta || meta.readOnly || meta.immutable) {
      setIgnoredNotice("Some suggestions were ignored (invalid/immutable).")
      return
    }
    const nextPatch = { ...(patch ?? {}) }
    nextPatch[slug] = value
    setPatch(nextPatch)
    setSelectedKeys((prev) => ({ ...prev, [slug]: true }))
    setAppliedMsg("Change added")
    setSuggestMessages((prev) =>
      groupAssistantText([
        ...prev,
        { id: crypto.randomUUID(), ts: Date.now(), role: "user", kind: "text", content: value ? "Yes" : "No" },
        { id: crypto.randomUUID(), ts: Date.now(), role: "system", kind: "notice", content: "Change added" },
      ])
    )
  }

  const messageContainerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const el = messageContainerRef.current
    if (!el) return
    const handleScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
      setIsAtBottom(atBottom)
    }
    el.addEventListener("scroll", handleScroll)
    return () => el.removeEventListener("scroll", handleScroll)
  }, [])

  React.useEffect(() => {
    if (isAtBottom && messageContainerRef.current) {
      const el = messageContainerRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [isAtBottom, suggestMessages, askMessages, patch, assistantMode])

  const activeMessages = assistantMode === "suggest" ? suggestMessages : askMessages

  const renderMessages = activeMessages.map((msg) => {
      if (msg.kind === "text") {
      const isUser = msg.role === "user"
      const isSystem = msg.role === "system"
      return (
        <div
          key={msg.id}
          className={`flex ${isSystem ? "justify-center" : isUser ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
              isSystem
                ? "bg-muted text-muted-foreground"
                : isUser
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-foreground"
            }`}
          >
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="m-0">{children}</p>,
                ul: ({ children }) => <ul className="mt-1 list-disc pl-5">{children}</ul>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        </div>
      )
    }
    if (msg.kind === "notice") {
      return (
        <div key={msg.id} className="flex justify-center">
          <div className="rounded-md bg-amber-100 px-3 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            {msg.content}
          </div>
        </div>
      )
    }
    if (msg.kind === "suggestion") {
      if (msg.superseded) {
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Suggested changes (superseded)
            </div>
          </div>
        )
      }
      const diffs = (() => {
        if (!patch) return []
        const current = context.currentValues ?? {}
        return Object.entries(patch).flatMap(([k, v]) => {
          const currentVal = current[k]
          if (currentVal === v) return []
          return [{ key: k, from: currentVal, to: v }]
        })
      })()
      return (
        <div key={msg.id} className="flex justify-start">
          <div className="w-full space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium text-foreground">Suggested changes</div>
              {confidence && (
                <span className="text-[11px] font-medium text-foreground">
                  {confidence.toLowerCase().includes("high") ? "🟢 " : confidence.toLowerCase().includes("low") ? "🟠 " : "🟡 "}
                  {confidence}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {diffs.length === 0 && <div className="text-xs text-muted-foreground">No changes suggested.</div>}
              {diffs.map((item) => {
                const warning = riskBadge(item.key)
                return (
                  <div
                    key={item.key}
                    className="flex flex-col gap-1 rounded-md border border-border bg-card/60 p-2 text-xs text-foreground"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={Boolean(selectedKeys[item.key])}
                          onChange={() => toggleKey(item.key)}
                        />
                        <span className="font-medium">{item.key}</span>
                      </label>
                      {warning && (
                        <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                          ⚠️ {warning}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-muted-foreground">
                      <span className="line-through decoration-muted-foreground/60">{String(item.from ?? "—")}</span>
                      <span className="text-foreground">→</span>
                      <span className="font-medium text-foreground">{String(item.to)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={applySelected} disabled={diffs.length === 0 || Object.values(selectedKeys).every((v) => !v)}>
                Apply selected changes
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide raw" : "View raw"}
              </Button>
            </div>
            {showRaw && (
              <pre className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[11px] text-foreground">
                {JSON.stringify(patch, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )
    }
    if (msg.kind === "question") {
      const meta = fieldMetaByName[msg.field]
      const lifecycleBlocked =
        (msg.field === "noncurrent_expiration_days" || msg.field === "abort_multipart_days") &&
        !context.currentValues?.enable_lifecycle
      if (meta?.type === "number") {
        const draft = followUpDrafts[msg.field] ?? ""
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="space-y-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-foreground">
              <div className="font-medium">Optional clarifications</div>
              <div className="text-sm">{msg.text}</div>
              {lifecycleBlocked ? (
                <div className="text-[11px] text-muted-foreground">Enable lifecycle first, then set days.</div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    className="w-28"
                    value={draft}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFollowUpDrafts((prev) => ({ ...prev, [msg.field]: e.target.value }))
                    }
                    placeholder="days"
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      const n = Number(draft)
                      if (Number.isNaN(n) || draft === "") return
                      handleFollowUp(msg.field, n)
                    }}
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
      }

      return (
        <div key={msg.id} className="flex justify-start">
          <div className="space-y-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-foreground">
            <div className="font-medium">Optional clarifications</div>
            <div className="text-sm">{msg.text}</div>
            <div className="flex flex-wrap gap-2">
              {msg.options.map((opt) => (
                <Button key={opt.label} size="xs" variant="outline" onClick={() => handleFollowUp(msg.field, opt.value)}>
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )
    }
    return null
  })

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 rounded-lg border border-border bg-muted/40 p-3">
        <div ref={messageContainerRef} className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {activeMessages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/80 bg-card/70 p-6 text-center">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground">Start a conversation</div>
                <div className="text-xs text-muted-foreground">Describe what you want.</div>
              </div>
            </div>
          ) : (
            renderMessages
          )}
        </div>
        {!isAtBottom && (
          <div className="mt-2 flex justify-center">
            <Button size="sm" variant="outline" onClick={() => setIsAtBottom(true)}>
              Jump to latest
            </Button>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 z-10 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
        {error && <div className="mb-1 text-xs text-destructive">{error}</div>}
        {appliedMsg && <div className="mb-1 text-xs text-emerald-600 dark:text-emerald-400">{appliedMsg}</div>}
        {ignoredNotice && <div className="mb-1 text-[11px] text-amber-700 dark:text-amber-300">{ignoredNotice}</div>}
        {askNotice && <div className="mb-1 text-[11px] text-amber-700 dark:text-amber-300">{askNotice}</div>}
        <div className="flex items-start gap-2 border-t border-border pt-2">
          <Textarea
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            placeholder={
              assistantMode === "ask" ? "Ask a question about this resource…" : "Describe what you want…"
            }
            className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-primary/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleAsk()
              }
            }}
          />
          <Button
            size="icon"
            variant="default"
            disabled={loading || !prompt.trim()}
            onClick={handleAsk}
            aria-label="Send"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
