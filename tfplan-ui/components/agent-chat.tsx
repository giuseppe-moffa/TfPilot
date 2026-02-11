"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Send } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ChatMessage = { id: string; role: "assistant" | "user"; content: string }

type AgentChatProps = {
  systemPrompt: string
  project?: string
  environment?: string
  initialUserContext?: string
  modules?: string[]
  requireModuleBeforeInput?: boolean
  onModuleSelected?: (module: string) => void
}

type PendingRequest = {
  project: string
  environment: string
  module: string
  config: Record<string, any>
  summary?: string
}

function toSnakeCase(key: string) {
  return key.replace(/([A-Z])/g, "_$1").replace(/-/g, "_").toLowerCase()
}

function normalizeConfigKeys(raw: Record<string, any> = {}) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    const snake = toSnakeCase(k)
    out[snake] = v
  }
  return out
}

const bubble =
  "max-w-[80%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed transition-all duration-200"

async function callChatApi(
  messages: { role: string; content: string }[],
  project?: string,
  environment?: string
) {
  const res = await fetch("/api/infra-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, project, environment }),
  })
  if (!res.ok) throw new Error("Chat API error")
  const data = await res.json()
  return data?.content ?? data?.message?.content ?? "Okay, let's continue."
}

export function AgentChat({
  systemPrompt,
  project,
  environment,
  initialUserContext,
  modules = [],
  requireModuleBeforeInput = true,
  onModuleSelected,
}: AgentChatProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [systemMessage] = React.useState<{ role: "system"; content: string }>({
    role: "system",
    content: systemPrompt,
  })
  const [input, setInput] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [moduleSelected, setModuleSelected] = React.useState(false)
  const [moduleMeta, setModuleMeta] = React.useState<Record<string, any> | null>(null)
  const [selectedModuleName, setSelectedModuleName] = React.useState<string | null>(null)
  const [isTyping, setIsTyping] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const router = useRouter()
  const [pendingRequest, setPendingRequest] = React.useState<PendingRequest | null>(null)
  const [isCreatingRequest, setIsCreatingRequest] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const appendMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const introShownRef = React.useRef(false)

  const handleConfirmation = (reply: string) => {
    let confirmation: PendingRequest | null = null
    const match = reply.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (parsed?.type === "confirmation" && parsed.project && parsed.environment && parsed.module) {
          confirmation = {
            project: parsed.project,
            environment: parsed.environment,
            module: parsed.module,
            config: parsed.config ?? parsed.inputs ?? {},
            summary: parsed.summary,
          }
          setPendingRequest(confirmation)
        }
      } catch {
        // ignore
      }
    }
    return confirmation
  }

  // Start conversation when initial context present, only once
  React.useEffect(() => {
    if (!initialUserContext || introShownRef.current) return
    introShownRef.current = true
    const intro = "What would you like to provision? Select a resource to get started:"
    appendMessage({ id: crypto.randomUUID(), role: "assistant", content: intro })
  }, [initialUserContext])

  const sendToAgent = async (userText: string, override?: { role: string; content: string }[]) => {
    const outbound =
      override ??
      [
        systemMessage,
        ...(initialUserContext ? [{ role: "user", content: initialUserContext }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userText },
      ]
    setLoading(true)
    setIsTyping(true)
    try {
      const reply = await callChatApi(outbound, project, environment)
      const confirmation = handleConfirmation(reply)
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: confirmation?.summary ?? reply,
      })
      void fetch("/api/chat-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          environment,
          module: moduleSelected ? selectedModuleName ?? undefined : undefined,
          messages: outbound,
        }),
      }).catch(() => {})
    } catch (err) {
      appendMessage({ id: crypto.randomUUID(), role: "assistant", content: "Sorry, I had trouble replying. Try again." })
    } finally {
      setLoading(false)
      setIsTyping(false)
    }
  }

  const handleSend = async (text: string) => {
    if (!text.trim()) return
    appendMessage({ id: crypto.randomUUID(), role: "user", content: text })
    setInput("")
    await sendToAgent(text)
  }

  const handleModuleClick = async (mod: string) => {
    setModuleSelected(true)
    setSelectedModuleName(mod)
    appendMessage({ id: crypto.randomUUID(), role: "user", content: mod })
    onModuleSelected?.(mod)
    try {
      const metaRes = await fetch(`/api/modules/${mod}`)
      const meta = metaRes.ok ? await metaRes.json() : null
      setModuleMeta(meta)
      const contextBlock = [
        "MODE=INTERVIEW",
        project ? `PROJECT=${project}` : "",
        environment ? `ENVIRONMENT=${environment}` : "",
        `MODULE_SELECTED=${mod}`,
        meta ? `MODULE_METADATA=${JSON.stringify(meta)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      await sendToAgent("", [
        systemMessage,
        ...(initialUserContext ? [{ role: "user", content: initialUserContext }] : []),
        { role: "user", content: contextBlock },
      ])
    } catch (err) {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I couldn't load that module metadata. Please try again.",
      })
    }
  }

  const inputDisabled =
    (requireModuleBeforeInput && !moduleSelected) || loading || pendingRequest !== null || isCreatingRequest

  return (
    <Card className="flex h-[70vh] flex-col border-none bg-transparent shadow-none">
      <div className="flex-1 overflow-y-auto px-1 py-2">
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                className={`flex ${msg.role === "assistant" ? "justify-start" : "justify-end"}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                {msg.role === "assistant" ? (
                  <div
                    className={`max-w-2xl space-y-4 rounded-2xl bg-muted/40 px-4 py-3 text-sm leading-relaxed prose prose-sm dark:prose-invert`}
                  >
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  </div>
                ) : (
                  <div className={`${bubble} bg-primary text-primary-foreground`}>{msg.content}</div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {!moduleSelected && modules.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {modules.map((m) => (
                <Button
                  key={m}
                  variant="outline"
                  size="sm"
                  onClick={() => handleModuleClick(m)}
                  disabled={isCreatingRequest}
                >
                  {m}
                </Button>
              ))}
            </div>
          )}
          {isTyping && (
            <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="max-w-2xl rounded-2xl bg-muted/40 px-4 py-3">
                <div className="flex gap-1 text-lg leading-relaxed">
                  <span className="animate-bounce delay-0">•</span>
                  <span className="animate-bounce delay-150">•</span>
                  <span className="animate-bounce delay-300">•</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSend(input)
        }}
        className="flex items-center gap-2 border-t bg-white px-2 py-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            pendingRequest ? "Review the summary below" : inputDisabled ? "Select a module to continue" : "Type your message"
          }
          className="flex-1"
          disabled={inputDisabled}
        />
        <Button type="submit" disabled={inputDisabled || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {pendingRequest && (
        <div className="mt-3 flex justify-start">
          <div className="max-w-2xl space-y-3 rounded-2xl bg-muted/40 px-4 py-3 text-sm leading-relaxed prose prose-sm dark:prose-invert">
            <div className="font-medium">Ready to create the request</div>
            {pendingRequest.summary && <div className="whitespace-pre-wrap break-words">{pendingRequest.summary}</div>}
            <Button
              disabled={loading || isCreatingRequest}
              onClick={async () => {
                setCreateError(null)
                setIsCreatingRequest(true)
                try {
                  const normalized = pendingRequest
                    ? { ...pendingRequest, config: normalizeConfigKeys(pendingRequest.config) }
                    : pendingRequest
                  const res = await fetch("/api/requests", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(normalized),
                  })
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    throw new Error(err?.error || "Failed to create request")
                  }
                  const data = await res.json()
                  if (data.requestId) {
                    router.push(`/requests/${data.requestId}`)
                  }
                } catch (err: any) {
                  setCreateError(err?.message || "Failed to create request")
                }
                setIsCreatingRequest(false)
              }}
            >
              {isCreatingRequest ? "Creating..." : "Create Request"}
            </Button>
            {isCreatingRequest && <div className="text-xs text-muted-foreground">Creating request…</div>}
            {createError && (
              <div className="text-xs text-destructive">
                {createError}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0 text-xs"
                    onClick={() => {
                      setCreateError(null)
                      setIsCreatingRequest(false)
                    }}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
