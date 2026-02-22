"use client"

import * as React from "react"
import { Loader2, Send } from "lucide-react"
import ReactMarkdown from "react-markdown"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { normalizeAssistantResponse, type AssistantResponse } from "@/utils/assistantNormalize"

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
  onAssistantState?: (state: any) => void
}

type ChatMessage =
  | { id: string; ts: number; role: "user" | "assistant" | "system"; kind: "text"; content: string }
  | { id: string; ts: number; role: "system"; kind: "notice"; content: string }
  | {
      id: string
      ts: number
      role: "assistant"
      kind: "question"
      questionId: string
      text: string
      field: string
      options: { label: string; value: any }[]
    }
  | { id: string; ts: number; role: "assistant"; kind: "suggestion"; title: string; superseded?: boolean }

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

export function AssistantHelper({ context, onAssistantState }: AssistantHelperProps) {

  const [prompt, setPrompt] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isAtBottom, setIsAtBottom] = React.useState(true)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  React.useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    }
  }, [prompt])

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value)
  }

  const sendChatLog = React.useCallback(
    async (msgs: Array<{ role: string; content: string }>) => {
      try {
        await fetch("/api/chat-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: context.project,
            environment: context.environment,
            module: context.module,
            messages: msgs,
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

  const handleSend = async () => {
    if (!prompt.trim()) return
    const currentPrompt = prompt
    setPrompt("")
    setIsAtBottom(true)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      role: "user",
      kind: "text",
      content: currentPrompt,
    }
    setMessages((prev) => groupAssistantText([...prev, userMessage]))
    setLoading(true)
    setError(null)
    try {
      const reqBody = {
        messages: [{ role: "user", content: currentPrompt }],
        project: context.project,
        environment: context.environment,
        module: context.module,
        fieldsMeta: context.fieldsMeta ?? [],
        currentInputs: context.currentValues ?? {},
      }
      const res = await fetch("/api/infra-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      })
      if (!res.ok) throw new Error("Assistant request failed")
      const data = await res.json()
      if (typeof console !== "undefined") {
        console.info("[AssistantHelper] raw response", {
          hasAssistantState: !!data?.assistant_state,
          assistantStateKeys: data?.assistant_state ? Object.keys(data.assistant_state) : [],
          content: data?.content,
          role: data?.role,
          fullDataKeys: Object.keys(data),
        })
      }
      const state: AssistantResponse =
        (data?.assistant_state as AssistantResponse) ??
        (() => {
          const content: string = data?.content ?? data?.message?.content ?? "{}"
          if (typeof console !== "undefined") {
            console.info("[AssistantHelper] parsing content from response:", content)
          }
          try {
            return JSON.parse(content) as AssistantResponse
          } catch (err) {
            if (typeof console !== "undefined") {
              console.warn("[AssistantHelper] failed to parse content:", err)
            }
            return { rationale: [content] }
          }
        })()

      const normalized = normalizeAssistantResponse({
        mode: "ask",
        response: state,
        fieldsMeta: context.fieldsMeta,
      })
      setMessages((prev) => groupAssistantText([...prev, ...normalized]))

      // Transform clarifications for suggestion panel
      const clarifications =
        state?.clarifications?.map((c) => ({
          id: c.id ?? crypto.randomUUID(),
          question: c.question,
          type: c.type ?? "text",
          required: true,
          field: c.field,
          options: c.options?.map((o) => ({ key: o.key, label: o.label })) ?? undefined,
          patchesByOption: c.patchesByOption,
          patchesFromText: c.patchesFromText,
        })) ?? []

      const assistantStateToSend = {
        ...state,
        clarifications, // Override with transformed clarifications
        // Don't add suggestions here - let SuggestionPanel create synthetic suggestions from patch
      }

      if (typeof console !== "undefined") {
        console.info("[AssistantHelper] Building assistant_state:", {
          rawStatePatchKeys: state.patch ? Object.keys(state.patch) : [],
          clarificationsCount: clarifications.length,
          assistantStateKeys: Object.keys(assistantStateToSend),
        })
      }

      if (onAssistantState) {
        onAssistantState(assistantStateToSend)
      }

      await sendChatLog([
        { role: "user", content: currentPrompt },
        { role: "assistant", content: JSON.stringify(state) },
      ])
    } catch (err: any) {
      setError(err?.message || "Failed to ask assistant")
    } finally {
      setLoading(false)
    }
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
  }, [isAtBottom, messages])

  const renderMessages = messages.map((msg) => {
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
    if (msg.kind === "question") {
      return (
        <div key={msg.id} className="flex justify-start">
          <div className="max-w-[80%] space-y-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
            <div className="font-medium text-foreground">{msg.text}</div>
            <div className="flex flex-wrap gap-2">
              {msg.options.map((opt) => (
                <Button
                  key={opt.label}
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    // For new requests, handle clarification responses locally
                    if (!context.currentValues?.request_id) {
                      // Add user response to chat
                      const userResponse: ChatMessage = {
                        id: crypto.randomUUID(),
                        ts: Date.now(),
                        role: "user",
                        kind: "text",
                        content: opt.label,
                      }
                      setMessages(prev => [...prev, userResponse])
                      // For new requests, we don't need to call the API
                      // The clarification will be resolved when the request is created
                      return
                    }

                    // For existing requests, send to API
                    try {
                      const res = await fetch(`/api/requests/${context.currentValues.request_id}/clarifications/respond`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          clarificationId: msg.questionId,
                          answer: opt.value
                        }),
                      })
                      if (res.ok) {
                        // Add user response to chat
                        const userResponse: ChatMessage = {
                          id: crypto.randomUUID(),
                          ts: Date.now(),
                          role: "user",
                          kind: "text",
                          content: opt.label,
                        }
                        setMessages(prev => [...prev, userResponse])
                        // Refresh the page/request data
                        window.location.reload()
                      }
                    } catch (err) {
                      console.error("Failed to submit clarification:", err)
                    }
                  }}
                >
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
    <div className="flex h-full flex-col">
      {/* Messages area - flexible height with dynamic bottom padding */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={messageContainerRef}
          className="flex h-full flex-col gap-3 overflow-y-auto p-3"
          style={{
            paddingBottom: '120px', // Increased space for expanded input
            scrollPaddingBottom: '120px' // Ensure scroll-to-bottom works
          }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-md bg-muted/30 p-6 text-center">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground">What would you like to provision?</div>
                <div className="text-xs text-muted-foreground">Ask me about infrastructure requirements</div>
              </div>
            </div>
          ) : (
            <>
              {renderMessages}
              {loading && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl bg-muted/60 px-4 py-2 text-sm">
                    <div className="flex items-center gap-1">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '0ms' }}></div>
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '150ms' }}></div>
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      <span className="text-xs text-muted-foreground ml-2">Assistant is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {!isAtBottom && (
          <div className="absolute bottom-24 right-4 flex justify-end">
            <Button size="icon" variant="ghost" onClick={() => setIsAtBottom(true)} aria-label="Scroll to latest">
              <span className="text-lg">↓</span>
            </Button>
          </div>
        )}
      </div>

      {/* Input area - positioned to grow upward */}
      <div className="absolute bottom-0 left-0 right-0 bg-muted/40 dark:bg-muted/30 px-3 py-3 shadow-sm">
        {error && <div className="mb-2 text-xs text-destructive">{error}</div>}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleTextareaChange}
            placeholder="Describe what infrastructure you need..."
            className="min-h-[44px] pr-12 rounded-lg bg-muted/50 dark:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 resize-none"
            style={{ maxHeight: '200px', overflowY: prompt.split('\n').length > 6 ? 'auto' : 'hidden' }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <Button
            size="sm"
            variant="default"
            disabled={loading || !prompt.trim()}
            onClick={handleSend}
            className="absolute right-2 top-2 h-8 w-8 p-0"
            aria-label="Send"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
