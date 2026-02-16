"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"

type PatchOp = { op: "set" | "unset"; path: string; value?: unknown }
type Hashable = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined

type Suggestion = {
  id: string
  severity: "low" | "medium" | "high"
  title: string
  description?: string
  patch: PatchOp[]
}

type Clarification = {
  id: string
  question: string
  type: "choice" | "text" | "boolean"
  required: boolean
  options?: Array<{ key: string; label: string }>
  placeholder?: string
  patchesByOption?: Record<string, PatchOp[]>
  patchesFromText?: { path: string; op: "set" }
  constraints?: { regex?: string; min?: number; max?: number }
}

type AssistantState = {
  suggestions?: Suggestion[]
  clarifications?: Clarification[]
  clarifications_resolved?: Record<string, { answer: unknown; ts: string }>
  last_suggestions_hash?: string | null
  patch?: Record<string, unknown>
}

type Props = {
  request: any
  requestId: string
  onRefresh: () => void
  onConfigUpdate?: (config: Record<string, unknown>) => void
  onAssistantStateClear?: () => void
}

function stableJson(value: Hashable): string {
  return JSON.stringify(value, Object.keys(value as any).sort())
}

function hashObject(value: Hashable): string {
  const str = stableJson(value)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return `sg-${Math.abs(hash)}`
}

function formatVal(v: unknown) {
  if (v === null || v === undefined) return "—"
  if (typeof v === "boolean" || typeof v === "number") return String(v)
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function getValueAtPath(config: Record<string, unknown> | undefined, path: string) {
  if (!config) return undefined
  const rawPath = path.replace(/^\/(inputs|advanced)\//, "")
  const parts = rawPath.split("/").filter(Boolean)
  let cursor: any = config
  for (const p of parts) {
    if (cursor === undefined || cursor === null) return undefined
    cursor = cursor[p]
  }
  return cursor
}

export function SuggestionPanel({ request, requestId, onRefresh, onConfigUpdate, onAssistantStateClear }: Props) {

  const [assistantOverride, setAssistantOverride] = React.useState<AssistantState | null>(null)
  const assistant: AssistantState = assistantOverride ?? request?.assistant_state ?? {}

  const suggestions = assistant.suggestions ?? []
  const patchObject = assistant.patch && typeof assistant.patch === "object" ? assistant.patch : null
  const patchEntries = patchObject ? Object.entries(patchObject) : []
  const hasPatchPreview = patchEntries.length > 0 && suggestions.length === 0
  const [persistedSuggestionId, setPersistedSuggestionId] = React.useState<string | null>(null)

  const patchOps: PatchOp[] = React.useMemo(() =>
    patchEntries.map(([k, v]) => ({
      op: "set",
      path: `/inputs/${k}`,
      value: v,
    }))
  , [patchEntries])

  const syntheticSuggestion: Suggestion | null = React.useMemo(() => {
    if (!hasPatchPreview) return null
    return {
      id: hashObject({ patchOps }),
      severity: "medium" as const,
      title: "Suggested changes",
      patch: patchOps,
    }
  }, [hasPatchPreview, patchOps])

  const derivedSuggestions: Suggestion[] = React.useMemo(() =>
    suggestions.length > 0 ? suggestions : syntheticSuggestion ? [syntheticSuggestion] : []
  , [suggestions, syntheticSuggestion])


  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [isCollapsed, setIsCollapsed] = React.useState(false)
  const persistingRef = React.useRef(false)
  const lastPatchIdsRef = React.useRef<string>('')

  // Debug showPanel logic - logged below when showPanel is calculated

  React.useEffect(() => {
    const currentPatchIds = (derivedSuggestions || [])
      .flatMap(s => (s?.patch || []).map((_, i) => `${s.id}-${i}`))
      .sort()
      .join(',')

    if (currentPatchIds !== lastPatchIdsRef.current) {
      lastPatchIdsRef.current = currentPatchIds
      const initial: Record<string, boolean> = {}
      for (const patchId of currentPatchIds.split(',')) {
        if (patchId) {
          initial[patchId] = false
        }
      }
      setSelected(initial)
    }
  }, [derivedSuggestions?.length, derivedSuggestions?.map(s => s.id).join(',')])

  const toggleSelection = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  React.useEffect(() => {
    // Skip persistence for new requests - they don't have a backend request yet
    if (requestId === "new-request") return

    const shouldPersist = syntheticSuggestion && !assistant.suggestions?.length && !persistedSuggestionId
    if (!shouldPersist || persistingRef.current) return
    persistingRef.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/assistant/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestions: [syntheticSuggestion],
          }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.request?.assistant_state) {
          setAssistantOverride(data.request.assistant_state)
          setPersistedSuggestionId(syntheticSuggestion.id)
          // refresh parent state so apply endpoint sees the persisted suggestion IDs
          onRefresh()
        } else if (typeof console !== "undefined") {
          console.warn("[SuggestionPanel] persist assistant_state failed", data)
        }
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("[SuggestionPanel] persist assistant_state error", err)
        }
      } finally {
        persistingRef.current = false
      }
    })()
  }, [assistant.suggestions?.length, onRefresh, persistedSuggestionId, requestId, syntheticSuggestion])

  const showPanel = derivedSuggestions.length > 0 || hasPatchPreview


  if (!showPanel) return null

  const recomputedHash: string | null = null // optional recompute not available client-side
  const showStaleBanner =
    suggestions.length > 0 &&
    assistant.last_suggestions_hash &&
    recomputedHash &&
    assistant.last_suggestions_hash !== recomputedHash

  const applySelected = async () => {
    const selectedIds = Object.entries(selected)
      .filter(([, isSelected]) => isSelected)
      .map(([id]) => id)


    if (selectedIds.length === 0) {
      setError("Select at least one suggestion to apply.")
      return
    }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      // For new requests, apply patches directly to form values
      if (requestId === "new-request" && onConfigUpdate) {
        // Apply selected patches to form values
        const updates: Record<string, any> = {}

        for (const patchId of selectedIds) {
          // Split on the last '-' to handle suggestion IDs that contain '-'
          const lastDashIndex = patchId.lastIndexOf('-')
          const suggestionId = patchId.substring(0, lastDashIndex)
          const patchIndexStr = patchId.substring(lastDashIndex + 1)
          const patchIndex = parseInt(patchIndexStr, 10)
          const suggestion = derivedSuggestions.find(s => s.id === suggestionId)

          if (suggestion && suggestion.patch[patchIndex]) {
            const patch = suggestion.patch[patchIndex]
            if (patch.op === "set" && patch.path.startsWith("/inputs/")) {
              const fieldName = patch.path.replace("/inputs/", "")
              updates[fieldName] = patch.value
            }
          }
        }

        console.log("[SuggestionPanel] Applying updates to form:", updates)
        // For new requests, update form values directly
        onConfigUpdate(updates)
        setStatus("Applied to configuration.")
        return
      }

        // For existing requests, use the API
      let ids = selectedIds

      // If we only have a synthetic suggestion, persist it first to get server-side IDs
      if (!assistant.suggestions?.length && syntheticSuggestion) {
        const res = await fetch(`/api/requests/${requestId}/assistant/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestions: [syntheticSuggestion],
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.request?.assistant_state?.suggestions?.length) {
          setError(data?.error ?? "Failed to persist suggestions.")
          return
        }
        const persisted = data.request.assistant_state
        setAssistantOverride(persisted)
        setPersistedSuggestionId(syntheticSuggestion.id)
        // For existing requests, we need to apply all suggestions since they were just persisted
        ids = persisted.suggestions.map((s: any) => s.id)
        onRefresh()
      }

      const res = await fetch(`/api/requests/${requestId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionIds: ids }),
      })
      if (res.status === 409) {
        setError("Request locked (plan/apply running).")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? "Failed to apply to configuration.")
        return
      }
      setStatus("Applied to configuration.")
      onRefresh()
    } finally {
      setLoading(false)
    }
  }



  return (
    <div className="px-4 py-3">
      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="text-sm font-semibold text-foreground">Suggestions</div>
        <div className="flex items-center gap-2">
          {showStaleBanner ? <div className="text-[11px] text-amber-700">Suggestions may be outdated</div> : null}
          <svg
            className={`w-4 h-4 transition-transform duration-300 ease-in-out ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      {status && <div className="text-xs text-emerald-600">{status}</div>}

      {!isCollapsed && derivedSuggestions.length > 0 && (
        <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
          <div className="space-y-3">
            {derivedSuggestions.flatMap((s) =>
              s.patch.map((patch, idx) => {
                const patchId = `${s.id}-${idx}`
                const oldVal = getValueAtPath(request?.config, patch.path)
                const newVal = patch.op === "unset" ? "unset" : patch.value
                return (
                  <div key={patchId} className="flex items-start gap-2 rounded-md border border-border bg-card/80 p-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3 w-3 flex-shrink-0"
                      checked={Boolean(selected[patchId])}
                      onChange={() => toggleSelection(patchId)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{patch.path.replace(/^\/inputs\//, "")}</div>
                      <div className="flex flex-wrap gap-2 text-muted-foreground">
                        <span className="line-through decoration-muted-foreground/60">{formatVal(oldVal)}</span>
                        <span className="text-foreground">→</span>
                        <span className="font-medium text-foreground">{formatVal(newVal)}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={applySelected} disabled={loading}>
              {loading ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}
