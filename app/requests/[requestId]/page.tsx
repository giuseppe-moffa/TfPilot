"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Copy, Github, Loader2, Link as LinkIcon, Download } from "lucide-react"
import useSWR from "swr"
import { useParams } from "next/navigation"

import { useRequestStatus } from "@/hooks/use-request-status"
import { normalizeRequestStatus, isActiveStatus } from "@/lib/status/status-config"
import { getStatusColor, getStatusLabel } from "@/lib/status/status-config"
import type { CanonicalStatus } from "@/lib/status/status-config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Code } from "@/components/ui/code"
import { cn } from "@/lib/utils"
import { stripPlanOutputToContent } from "@/lib/plan/strip-plan-output"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ActionProgressDialog,
  type ActionProgressStep,
} from "@/components/action-progress-dialog"
import { StatusIndicator } from "@/components/status/StatusIndicator"
import { AssistantHelper } from "@/components/assistant-helper"
import { AssistantDrawer } from "@/components/assistant-drawer"
import { SuggestionPanel } from "@/components/suggestion-panel"

type FieldMeta = {
  name: string
  type: "string" | "number" | "boolean" | "map" | "list" | "enum"
  required?: boolean
  default?: unknown
  description?: string
  enum?: string[]
  immutable?: boolean
  readOnly?: boolean
  sensitive?: boolean
  risk_level?: "low" | "medium" | "high"
  category?: string
}

type ModuleSchema = {
  type: string
  category: string
  description: string
  fields: FieldMeta[]
}

const steps = [
  { key: "submitted", label: "Submitted" },
  { key: "planned", label: "Plan Ready" },
  { key: "approved", label: "Approved" },
  { key: "merged", label: "Merged" },
  { key: "applied", label: "Applied" },
] as const

function TimelineStep({
  displayLabel,
  status,
  state,
  timestamp,
  hidePulse,
}: {
  displayLabel: string
  status: CanonicalStatus
  state: "pending" | "done" | "current"
  timestamp?: string
  hidePulse?: boolean
}) {
  const isDone = state === "done"
  const isCurrent = state === "current"
  const isActive = isDone || isCurrent
  const showPulse = !hidePulse && isCurrent && isActiveStatus(status)
  const color = isActive ? getStatusColor(status) : undefined
  const borderTint = color ? `${color}40` : undefined
  const glowTint = isCurrent && color ? `${color}26` : undefined
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-4 shrink-0 items-center justify-center">
        <div
          className={cn(
            "relative z-10 shrink-0 rounded-full border-2 box-border",
            !isActive && "border-muted-foreground/25 dark:border-border"
          )}
          style={{
            width: 12,
            height: 12,
            boxSizing: "border-box",
            backgroundColor: isActive ? color : "var(--card)",
            ...(isActive ? { borderColor: borderTint } : {}),
            boxShadow: glowTint ? `0 0 0 2px ${glowTint}` : undefined,
          }}
          aria-hidden
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "text-sm font-medium",
              isActive ? "text-foreground" : "text-muted-foreground opacity-95"
            )}
            style={color ? { color } : undefined}
          >
            {displayLabel}
          </p>
        {showPulse && color && (
          <Loader2
            className="size-3.5 shrink-0 animate-spin opacity-80"
            style={{ color }}
            aria-hidden
          />
        )}
        </div>
        {timestamp && (
          <p className="text-xs text-muted-foreground mt-0.5">{timestamp}</p>
        )}
      </div>
    </div>
  )
}

function lineClass(line: string) {
  const trimmed = line.trimStart()
  if (trimmed.startsWith("@@")) return "bg-muted text-foreground"
  if (trimmed.startsWith("+"))
    return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
  if (trimmed.startsWith("-"))
    return "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
  return "text-foreground"
}

function lineNumberClass(line: ParsedPatchLine) {
  if (line.kind === "meta") return "bg-muted text-muted-foreground"
  if (line.kind === "add")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
  if (line.kind === "del")
    return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100"
  return "text-muted-foreground"
}

type ParsedPatchLine = {
  old?: number
  new?: number
  text: string
  kind: "add" | "del" | "ctx" | "meta"
}

function parsePatch(patch: string): ParsedPatchLine[] {
  const out: ParsedPatchLine[] = []
  const lines = patch.split("\n")
  const hunkRe = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(hunkRe)
      if (m) {
        oldLine = parseInt(m[1], 10) - 1
        newLine = parseInt(m[2], 10) - 1
      }
      out.push({ text: line, kind: "meta" })
      continue
    }
    if (line.startsWith("+")) {
      newLine += 1
      out.push({ text: line, new: newLine, kind: "add" })
      continue
    }
    if (line.startsWith("-")) {
      oldLine += 1
      out.push({ text: line, old: oldLine, kind: "del" })
      continue
    }
    if (line.startsWith("\\")) {
      out.push({ text: line, kind: "meta" })
      continue
    }
    oldLine += 1
    newLine += 1
    out.push({ text: line, old: oldLine, new: newLine, kind: "ctx" })
  }

  return out
}

function renderBlock(content: string) {
  return content
    .trim()
    .split("\n")
    .map((line, idx) => (
      <div key={idx} className={`rounded px-2 py-0.5 ${lineClass(line)}`}>
        {line}
      </div>
    ))
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

function getServiceName(config?: Record<string, unknown>) {
  if (!config) return null
  const keys = ["name", "serviceName"]
  for (const key of keys) {
    const val = config[key]
    if (typeof val === "string" && val.trim()) return val
  }
  return null
}

function stripLogTimestamps(text: string) {
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(\s+)/u
  return text
    .split("\n")
    .map((line) => line.replace(re, "$1"))
    .join("\n")
}

function normalizePlanHeadings(text: string) {
  const headingRe = /(module\.[\w.-]+\.[\w.-]+)\.this\b/gi
  return text.replace(headingRe, "$1")
}

function parsePlanSummary(planText: string): { add: number; change: number; destroy: number } {
  if (!planText || !planText.trim()) return { add: 0, change: 0, destroy: 0 }
  const addMatch = planText.match(/(\d+)\s+to\s+add/i)
  const changeMatch = planText.match(/(\d+)\s+to\s+change/i)
  const destroyMatch = planText.match(/(\d+)\s+to\s+destroy/i)
  return {
    add: addMatch ? parseInt(addMatch[1], 10) : 0,
    change: changeMatch ? parseInt(changeMatch[1], 10) : 0,
    destroy: destroyMatch ? parseInt(destroyMatch[1], 10) : 0,
  }
}

function humanize(text?: string) {
  if (!text) return ""
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatEventName(event?: string) {
  if (!event) return "Event"
  const friendly: Record<string, string> = {
    request_created: "Request Created",
    plan_dispatched: "Plan Dispatched",
    request_approved: "Request Approved",
    pr_merged: "PR Merged",
    apply_dispatched: "Apply Dispatched",
    destroy_dispatched: "Destroy Dispatched",
    configuration_updated: "Configuration Updated",
  }
  return friendly[event] ?? humanize(event)
}

function buildLink(key: string, value: string, data?: Record<string, unknown>) {
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  const targetRepo = typeof data?.targetRepo === "string" ? data.targetRepo : undefined
  if (targetRepo) {
    if (/pr(number)?/i.test(key) && value) {
      return `https://github.com/${targetRepo}/pull/${value}`
    }
    if (/sha|commit/i.test(key) && /^[a-fA-F0-9]{7,40}$/.test(value)) {
      return `https://github.com/${targetRepo}/commit/${value}`
    }
    if (/branch/i.test(key) && value) {
      return `https://github.com/${targetRepo}/tree/${value}`
    }
    if (key === "targetRepo") {
      return `https://github.com/${targetRepo}`
    }
  }
  return null
}

function formatDataEntry(key: string, value: unknown, data?: Record<string, unknown>) {
  const label = humanize(key)
  if (value === null || value === undefined) return { label, value: "—" }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const strVal = String(value)
    const href = buildLink(key, strVal, data)
    return { label, value: strVal, href }
  }
  try {
    return { label, value: JSON.stringify(value) }
  } catch {
    return { label, value: String(value) }
  }
}

function RequestDetailPage() {
  const routeParams = useParams()
  const requestId =
    typeof routeParams?.requestId === "string"
      ? routeParams.requestId
      : Array.isArray(routeParams?.requestId)
        ? routeParams?.requestId[0]
        : undefined

  const [isApplying, setIsApplying] = React.useState(false)
  const [isApproving, setIsApproving] = React.useState(false)
  const [approveModalOpen, setApproveModalOpen] = React.useState(false)
  const [applyModalOpen, setApplyModalOpen] = React.useState(false)
  const [approveStatus, setApproveStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [mergeError, setMergeError] = React.useState<string | null>(null)
  const [updatingBranch, setUpdatingBranch] = React.useState(false)
  const [mergeStatus, setMergeStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [mergeModalOpen, setMergeModalOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [destroyModalOpen, setDestroyModalOpen] = React.useState(false)
  const [actionProgress, setActionProgress] = React.useState<
    null | "approve" | "merge" | "apply" | "destroy"
  >(null)
  const actionProgressTimerRef = React.useRef<number | null>(null)
  const [destroyStatus, setDestroyStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [destroyError, setDestroyError] = React.useState<string | null>(null)
  const [destroyConfirmation, setDestroyConfirmation] = React.useState("")
  const [applyNote, setApplyNote] = React.useState("")
  const [showApplyOutput, setShowApplyOutput] = React.useState(false)
  const [planLogExpanded, setPlanLogExpanded] = React.useState(false)
  const [initialRequest, setInitialRequest] = React.useState<any>(null)
  const [initialLoading, setInitialLoading] = React.useState<boolean>(true)
  const [updateModalOpen, setUpdateModalOpen] = React.useState(false)
  const [moduleSchemas, setModuleSchemas] = React.useState<ModuleSchema[] | null>(null)
  const [patchText, setPatchText] = React.useState("{\n}")
  const [patchError, setPatchError] = React.useState<string | null>(null)
  const [patchSubmitting, setPatchSubmitting] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const drawerWidth = 520
  const [assistantStateOverride, setAssistantStateOverride] = React.useState<any>(null)
  const [panelAssistantState, setPanelAssistantState] = React.useState<any>(null)

  const fetcher = React.useCallback(async (url: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}`)
    return res.json()
  }, [])

  React.useEffect(() => {
    if (!requestId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setInitialRequest(data.request)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [requestId])

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/modules/schema", { cache: "no-store" })
        const data = await res.json()
        if (!data?.success || data.schemaVersion !== 2 || !Array.isArray(data.modules)) {
          throw new Error("Schema contract v2 required")
        }
        setModuleSchemas(data.modules as ModuleSchema[])
      } catch (err) {
        console.error("[request detail] failed to load schema", err)
      }
    })()
  }, [])

  const { request, mutate: mutateStatus } = useRequestStatus(requestId, initialRequest)

  React.useEffect(() => {
    // Set panelAssistantState from request only if we don't have a more recent assistant state
    // This ensures that fresh assistant responses take priority over persisted request data
    if (!panelAssistantState && !assistantStateOverride) {
      setPanelAssistantState(request?.assistant_state ?? null)
    }
  }, [request, panelAssistantState, assistantStateOverride])

  const planRunId = request?.planRun?.runId ?? request?.planRunId
  const applyRunId = request?.applyRun?.runId ?? request?.applyRunId
  const prNumber = request?.pr?.number ?? request?.pullRequest?.number ?? request?.pr?.number

  const planKey = planRunId && !(request?.plan?.output) ? [`plan-output`, requestId, planRunId] : null
  const { data: planOutput, isLoading: planOutputLoading } = useSWR(
    planKey,
    () => fetcher(`/api/github/plan-output?requestId=${requestId}`),
    {
      keepPreviousData: true,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
    }
  )

  const prFilesKey = prNumber ? [`pr-files`, requestId, prNumber] : null
  const { data: prFiles, error: prFilesError } = useSWR(
    prFilesKey,
    () => fetcher(`/api/github/pr-diff?requestId=${requestId}`),
    {
      keepPreviousData: true,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      onErrorRetry: () => {}, // don't spam retries for missing PRs
    }
  )

  const applyKey = showApplyOutput && applyRunId ? [`apply-output`, requestId, applyRunId] : null
  const { data: applyOutput } = useSWR(applyKey, () => fetcher(`/api/github/apply-output?requestId=${requestId}`), {
    keepPreviousData: true,
    dedupingInterval: 5000,
    revalidateOnFocus: false,
  })

  const logsKey = requestId ? [`request-logs`, requestId] : null
  const { data: logsData, isLoading: logsLoading, mutate: mutateLogs } = useSWR(
    logsKey,
    () => fetcher(`/api/requests/${requestId}/logs`),
    {
      keepPreviousData: true,
      revalidateOnFocus: true,
      refreshInterval: 8000,
      revalidateOnReconnect: true,
    }
  )

  const canDestroyKey = requestId ? [`can-destroy`, requestId] : null
  const { data: canDestroyData, isLoading: canDestroyLoading } = useSWR(
    canDestroyKey,
    () => fetcher(`/api/requests/${requestId}/can-destroy`),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
    }
  )
  // Default to false (disabled) until we know for sure - safer for prod destroy
  const canDestroy = canDestroyData?.canDestroy === true

  const eventOrder: Record<string, number> = {
    request_created: 0,
    plan_dispatched: 1,
    configuration_updated: 2,
    request_approved: 3,
    pr_merged: 4,
    apply_dispatched: 5,
    destroy_dispatched: 6,
  }

  const updateAllowedFields = React.useMemo(() => {
    const schema = moduleSchemas?.find((s) => s.type === request?.module)
    const fields = schema
      ? schema.fields.filter((f: FieldMeta) => !(f.readOnly || f.immutable)).map((f: FieldMeta) => f.name)
      : Object.keys(request?.config ?? {})
    return fields
  }, [moduleSchemas, request?.module, request?.config])

  const sortedEvents = React.useMemo(() => {
    if (!logsData?.events) return []
    return [...logsData.events].sort((a: any, b: any) => {
      const ao = eventOrder[a?.event ?? ""] ?? 99
      const bo = eventOrder[b?.event ?? ""] ?? 99
      if (ao !== bo) return ao - bo
      const ta = Date.parse(a?.timestamp ?? "")
      const tb = Date.parse(b?.timestamp ?? "")
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb
      return 0
    })
  }, [logsData?.events])

  const eventToStep: Record<string, (typeof steps)[number]["key"]> = {
    request_created: "submitted",
    plan_dispatched: "planned",
    request_approved: "approved",
    pr_merged: "merged",
    apply_dispatched: "applied",
  }
  const stepTimestamps = React.useMemo(() => {
    const out: Partial<Record<(typeof steps)[number]["key"], string>> = {}
    for (const evt of sortedEvents) {
      const stepKey = eventToStep[evt?.event ?? ""]
      const ts = evt?.timestamp
      if (stepKey && ts && !out[stepKey]) {
        const parsed = Date.parse(ts)
        if (!Number.isNaN(parsed)) out[stepKey] = formatDate(ts)
      }
    }
    return out
  }, [sortedEvents])

  function startActionProgress(action: "approve" | "merge" | "apply" | "destroy") {
    if (actionProgressTimerRef.current) {
      clearTimeout(actionProgressTimerRef.current)
      actionProgressTimerRef.current = null
    }
    if (action === "approve") {
      setActionProgress("approve")
      return
    }
    setActionProgress(null)
    actionProgressTimerRef.current = window.setTimeout(() => setActionProgress(action), 400)
  }
  function clearActionProgress() {
    if (actionProgressTimerRef.current) {
      clearTimeout(actionProgressTimerRef.current)
      actionProgressTimerRef.current = null
    }
    setActionProgress(null)
  }

  React.useEffect(() => {
    return () => {
      if (actionProgressTimerRef.current) clearTimeout(actionProgressTimerRef.current)
    }
  }, [])

  async function handleApplyOnly() {
    if (!requestId || !request || request.status !== "approved") return
    setApplyModalOpen(false)
    setIsApplying(true)
    setApplyStatus("pending")
    startActionProgress("apply")
    try {
      await fetch(`/api/requests/${requestId}/apply`, { method: "POST" })
      await mutateStatus(undefined, true)
      setApplyStatus("success")
    } catch (err) {
      console.error("[request apply] error", err)
      setApplyStatus("error")
    } finally {
      clearActionProgress()
      setIsApplying(false)
    }
  }

  async function handleApplyDispatch(): Promise<boolean> {
    if (!requestId || requestStatus !== "merged") {
      return false
    }
    setIsApplying(true)
    setActionError(null)
    startActionProgress("apply")
    try {
      const res = await fetch("/api/github/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Failed to dispatch apply")
      }
      await mutateStatus(undefined, true)
      return true
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch apply")
      return false
    } finally {
      clearActionProgress()
      setTimeout(() => setIsApplying(false), 2000)
    }
  }

  async function handleDestroy(): Promise<boolean> {
    if (!requestId || isDestroying || isDestroyed) return false
    setDestroyError(null)
    startActionProgress("destroy")
    try {
      const res = await fetch(`/api/requests/${requestId}/destroy`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Failed to dispatch destroy")
      }
      await mutateStatus(undefined, true)
      return true
    } catch (err: unknown) {
      setDestroyError(err instanceof Error ? err.message : "Failed to dispatch destroy")
      return false
    } finally {
      clearActionProgress()
    }
  }

  async function handlePatchSubmit() {
    setPatchError(null)
    if (!requestId) {
      setPatchError("Missing requestId")
      return
    }
    let parsed: Record<string, unknown> | null = null
    try {
      const obj = JSON.parse(patchText)
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error()
      parsed = obj
    } catch {
      setPatchError("Patch must be valid JSON object")
      return
    }
    setPatchSubmitting(true)
    try {
      const res = await fetch("/api/requests/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, patch: parsed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit update")
      }
      setUpdateModalOpen(false)
      await mutateStatus(undefined, true)
    } catch (err: any) {
      setPatchError(err?.message || "Failed to submit update")
    } finally {
      setPatchSubmitting(false)
    }
  }

  async function handleMerge() {
    if (!requestId || !request || request.status !== "approved") return
    setMergeModalOpen(false)
    setMergeStatus("pending")
    startActionProgress("merge")
    try {
      const res = await fetch("/api/github/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to merge PR")
      }
      if (data.branchUpdated) {
        await mutateStatus(undefined, true)
        setMergeError(null)
      } else {
        await mutateStatus(undefined, true)
      }
    } catch (err) {
      console.error("[request merge] error", err)
      setMergeStatus("error")
      setMergeError(err instanceof Error ? err.message : "Merge failed")
      setMergeModalOpen(true)
    } finally {
      clearActionProgress()
    }
  }

  async function handleUpdateBranch() {
    if (!requestId) return
    setUpdatingBranch(true)
    setMergeError(null)
    try {
      const res = await fetch("/api/github/update-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update branch")
      }
      await mutateStatus(undefined, true)
      setMergeStatus("idle")
      setMergeModalOpen(false)
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Failed to update branch")
    } finally {
      setUpdatingBranch(false)
    }
  }

  const mergeNeedsUpdate = !!(
    mergeStatus === "error" &&
    mergeError &&
    (mergeError.includes("dirty") || mergeError.includes("not mergeable"))
  )

  async function handleApprove() {
    if (!requestId || !request || request.status === "approved" || request.status === "applied") return
    setIsApproving(true)
    setApproveStatus("pending")
    startActionProgress("approve")
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Approve failed")
      await mutateStatus(undefined, true)
      setApproveStatus("success")
      setApproveModalOpen(false)
    } catch (err) {
      console.error("[request approve] error", err)
      setApproveStatus("error")
      setIsApproving(false)
    } finally {
      clearActionProgress()
    }
  }

  const requestStatus = request?.status ?? "created"
  const planSucceeded =
    request?.planRun?.conclusion === "success" || request?.planRun?.status === "completed"
  const planFailed = request?.planRun?.conclusion === "failure"
  const planRunStatus = request?.planRun?.status
  const planRunConclusion = request?.planRun?.conclusion
  const planRunUrl = request?.planRun?.url
  const planRunning =
    planRunStatus === "in_progress" ||
    planRunStatus === "queued" ||
    (!!planRunId &&
      (requestStatus === "planning" ||
        requestStatus === "pr_open" ||
        requestStatus === "created" ||
        requestStatus === "pending") &&
      !planRunConclusion)
  const hasPlanText = !!(
    planOutput?.planText ?? request?.plan?.output ?? request?.pullRequest?.planOutput
  )
  const planFetchingOutput =
    !!planRunId &&
    !planRunning &&
    !hasPlanText &&
    (planOutputLoading || (!!planKey && !planOutput?.planText))
  const prMerged =
    request?.pr?.merged ??
    request?.pullRequest?.merged ??
    request?.pullRequest?.open === false
  const applySucceeded =
    request?.applyRun?.conclusion === "success" ||
    requestStatus === "complete" ||
    requestStatus === "applied"
  const applyFailed = request?.applyRun?.conclusion === "failure"

  const applyRunning =
    requestStatus === "applying" || request?.applyRun?.status === "in_progress"
  const isApplyingDerived =
    isApplying || applyRunning || applyStatus === "pending" || applyStatus === "success"
  const isApplied = applySucceeded
  const isMerged = prMerged || requestStatus === "merged" || requestStatus === "applying" || isApplied
  const isDestroying = requestStatus === "destroying"
  const isDestroyed = requestStatus === "destroyed"
  const isPlanReady =
    planSucceeded ||
    requestStatus === "plan_ready" ||
    requestStatus === "planned" ||
    requestStatus === "approved" ||
    requestStatus === "awaiting_approval" ||
    isMerged ||
    isApplied
  const isApproved =
    request?.approval?.approved ||
    requestStatus === "approved" ||
    requestStatus === "awaiting_approval" ||
    isMerged ||
    isApplied ||
    false
  const isPlanning =
    requestStatus === "planning" || requestStatus === "pr_open" || requestStatus === "created" || requestStatus === "pending"
  const isFailed = requestStatus === "failed" || applyFailed || planFailed

  // Reset transient apply UI state once backend reflects completion or failure
  React.useEffect(() => {
    if (applySucceeded || applyFailed || requestStatus === "applied" || requestStatus === "failed") {
      setApplyStatus("idle")
      setIsApplying(false)
    }
  }, [applySucceeded, applyFailed, requestStatus])

  // Clear approve loading state only when timeline shows approved (request data has updated)
  React.useEffect(() => {
    if (
      request &&
      (request.status === "approved" || request.approval?.approved)
    ) {
      setIsApproving(false)
    }
  }, [request?.status, request?.approval?.approved])

  // Clear merge loading state only when timeline shows merged (request data has updated)
  const prMergedForEffect =
    request?.pr?.merged ??
    request?.pullRequest?.merged ??
    request?.pullRequest?.open === false
  React.useEffect(() => {
    if (request && (prMergedForEffect || request.status === "merged")) {
      setMergeStatus("idle")
      setMergeError(null)
    }
  }, [request, prMergedForEffect])

  function computeStepInfo() {
    if (isDestroyed) {
      return {
        key: "applied" as const,
        state: "completed" as const,
        subtitle: "Destroyed",
      }
    }
    if (isDestroying) {
      return {
        key: "applied" as const,
        state: "pending" as const,
        subtitle: "Destroying resources",
      }
    }
    if (actionProgress === "destroy" && isApplied && !isDestroyed) {
      return {
        key: "applied" as const,
        state: "pending" as const,
        subtitle: "Destroying…",
      }
    }
    if (isApplied) {
      return {
        key: "applied" as const,
        state: "completed" as const,
        subtitle: "Deployment Completed",
      }
    }
    if (requestStatus === "applying" || requestStatus === "applying_changes") {
      return {
        key: "applied" as const,
        state: "pending" as const,
        subtitle: "Applying…",
      }
    }
    if (
      isMerged &&
      !isApplied &&
      !isDestroying &&
      !isDestroyed &&
      !isFailed
    ) {
      return {
        key: "applied" as const,
        state: "pending" as const,
        subtitle:
          isApplyingDerived || actionProgress === "apply"
            ? "Applying…"
            : "Waiting for apply",
      }
    }
    if (isMerged) {
      return {
        key: "merged" as const,
        state: "completed" as const,
        subtitle: "Pull request merged",
      }
    }
    if (
      isApproved &&
      !isMerged &&
      !isApplied &&
      !isDestroying &&
      !isDestroyed &&
      !isFailed
    ) {
      return {
        key: "merged" as const,
        state: "pending" as const,
        subtitle:
          mergeStatus === "pending" || actionProgress === "merge"
            ? "Merging…"
            : "Waiting for PR merge",
      }
    }
    if (isApproved) {
      return {
        key: "approved" as const,
        state: "completed" as const,
        subtitle: "Approved",
      }
    }
    if (
      isPlanReady &&
      !isApproved &&
      !isMerged &&
      !isApplied &&
      !isDestroying &&
      !isDestroyed &&
      !isFailed
    ) {
      return {
        key: "approved" as const,
        state: "pending" as const,
        subtitle:
          isApproving || actionProgress === "approve" ? "Approving…" : "Waiting for approval",
      }
    }
    if (isPlanning) {
      return {
        key: "planned" as const,
        state: "pending" as const,
        subtitle: "Planning in progress",
      }
    }
    if (isFailed) {
      return {
        key: "submitted" as const,
        state: "pending" as const,
        subtitle: "Failed",
      }
    }
    return {
      key: "submitted" as const,
      state: "pending" as const,
      subtitle: "Submitted",
    }
  }

  const stepInfo = computeStepInfo()
  function stepState(stepKey: (typeof steps)[number]["key"]) {
    switch (stepKey) {
      case "submitted":
        return "done"
      case "planned":
        return isPlanReady ? "done" : "pending"
      case "approved":
        return isApproved ? "done" : isPlanReady ? "pending" : "pending"
      case "merged":
        return isMerged ? "done" : "pending"
      case "applied":
        return isApplied || isDestroying || isDestroyed ? "done" : "pending"
      default:
        return "pending"
    }
  }

  function stepSubtitle(stepKey: (typeof steps)[number]["key"], state: "pending" | "done") {
    switch (stepKey) {
      case "submitted":
        return "Request created"
      case "planned":
        if (planFailed) return "Plan failed"
        return state === "done" ? "Plan ready" : "Waiting for plan"
      case "approved":
        return state === "done" ? "Approved" : "Waiting for approval"
      case "merged":
        return state === "done" ? "Pull request merged" : "Waiting for PR merge"
      case "applied":
        if (applyFailed) return "Apply failed"
        return state === "done" ? "Deployment Completed" : "Waiting for apply"
      default:
        return "Pending"
    }
  }

  function getStepCanonicalStatus(
    stepKey: (typeof steps)[number]["key"],
    state: "pending" | "done"
  ): CanonicalStatus {
    switch (stepKey) {
      case "submitted":
        return "request_created"
      case "planned":
        return state === "done" ? (planFailed ? "failed" : "plan_ready") : "planning"
      case "approved":
        return state === "done" ? "approved" : "planning"
      case "merged":
        return state === "done" ? "merged" : "planning"
      case "applied":
        if (state === "done") {
          if (isDestroyed) return "destroyed"
          if (isDestroying || actionProgress === "destroy") return "destroying"
          if (applyFailed) return "failed"
          return "applied"
        }
        if (requestStatus === "applying" || requestStatus === "applying_changes") return "applying"
        return "planning"
      default:
        return "request_created"
    }
  }

  const PENDING_STEP_LABELS: Record<(typeof steps)[number]["key"], string> = {
    submitted: "Request created",
    planned: "Waiting for plan",
    approved: "Waiting for approval",
    merged: "Waiting for PR merge",
    applied: "Waiting for apply",
  }

  function getStepDisplayLabel(
    stepKey: (typeof steps)[number]["key"],
    state: "pending" | "done" | "current",
    status?: CanonicalStatus
  ): string {
    if (state === "done" || stepKey === "submitted") {
      return getStatusLabel(getStepCanonicalStatus(stepKey, "done"))
    }
    if (stepKey === "approved" && state === "current" && (actionProgress === "approve" || isApproving)) {
      return "Approving…"
    }
    if (stepKey === "approved" && state === "current") {
      return "Waiting for approval"
    }
    if (stepKey === "merged" && state === "current" && (mergeStatus === "pending" || actionProgress === "merge")) {
      return "Merging…"
    }
    if (stepKey === "merged" && state === "current") {
      return "Waiting for PR merge"
    }
    if (stepKey === "applied" && state === "current" && (isDestroying || actionProgress === "destroy")) {
      return "Destroying…"
    }
    if (stepKey === "applied" && state === "current" && (isApplyingDerived || actionProgress === "apply")) {
      return "Applying…"
    }
    if (stepKey === "applied" && state === "current") {
      return "Waiting for apply"
    }
    if (state === "current" && status && isActiveStatus(status)) {
      return getStatusLabel(status)
    }
    return PENDING_STEP_LABELS[stepKey]
  }

  if (initialLoading && !request) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading request...
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading request...
      </div>
    )
  }

  const hasDrift = request.drift?.status === "detected"

  const canonicalStatus = normalizeRequestStatus(
    isDestroyed ? "destroyed" : isDestroying ? "destroying" : requestStatus,
    { isDestroyed, isDestroying }
  )

  const ACTION_PROGRESS_CONFIG: Record<
    "approve" | "merge" | "apply" | "destroy",
    { title: string; body: string; steps: ActionProgressStep[] }
  > = {
    approve: {
      title: "Approving…",
      body: "Recording approval and updating request status.",
      steps: [
        { label: "Saving approval", status: "done" },
        { label: "Updating request status", status: "in_progress" },
        { label: "Complete", status: "pending" },
      ],
    },
    merge: {
      title: "Merging…",
      body: "Merging pull request and updating branch.",
      steps: [
        { label: "Merging PR", status: "done" },
        { label: "Updating branch", status: "in_progress" },
        { label: "Complete", status: "pending" },
      ],
    },
    apply: {
      title: "Applying…",
      body: "Running Terraform apply workflow.",
      steps: [
        { label: "Dispatching workflow", status: "done" },
        { label: "Running Terraform apply", status: "in_progress" },
        { label: "Complete", status: "pending" },
      ],
    },
    destroy: {
      title: "Destroying…",
      body: "Tearing down resources and updating request.",
      steps: [
        { label: "Dispatching destroy", status: "done" },
        { label: "Tearing down resources", status: "in_progress" },
        { label: "Complete", status: "pending" },
      ],
    },
  }

  return (
    <div
      className="mx-auto max-w-7xl space-y-8 transition-[margin-right]"
      style={{ marginRight: assistantOpen ? drawerWidth : 0 }}
    >
      {actionProgress && (
        <ActionProgressDialog
          open
          title={ACTION_PROGRESS_CONFIG[actionProgress].title}
          body={ACTION_PROGRESS_CONFIG[actionProgress].body}
          steps={ACTION_PROGRESS_CONFIG[actionProgress].steps}
        />
      )}
      {hasDrift && (
        <Card className="border-0 bg-destructive/5 shadow-sm">
          <CardContent className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="destructive">Drift Detected</Badge>
                  {request.drift?.lastCheckedAt && (
                    <span className="text-xs text-muted-foreground">
                      Last checked: {new Date(request.drift.lastCheckedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground mb-1.5">
                  Infrastructure drift has been detected. Review the plan to see what has changed.
                </p>
                {request.drift?.summary && (
                  <p className="text-xs text-muted-foreground mb-1.5">{request.drift.summary}</p>
                )}
                {request.drift?.runUrl && (
                  <a
                    href={request.drift.runUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <LinkIcon className="size-4" />
                    View drift plan run
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="rounded-xl bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold leading-tight">Request {request.id}</h1>
              {request.revision ? (
                <Badge variant="secondary" className="font-normal">Rev {request.revision}</Badge>
              ) : null}
              <StatusIndicator status={canonicalStatus} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {request.project} · {request.environment} · {request.module ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setUpdateModalOpen(true)}>
              Update Configuration
            </Button>
          </div>
        </div>

        <div className="mt-4 mb-6 border-t border-border/50 dark:border-slate-800/50" />

        <div className="grid grid-cols-1 md:grid-cols-2 md:gap-0 items-stretch">
          <div className="min-w-0 h-full">
            <div className="px-5 pt-4 pb-4">
              <h3 className="text-base font-medium leading-none">Overview</h3>
              <p className="text-xs text-muted-foreground mt-2">
                Request metadata
              </p>
            </div>
            <div className="px-5 pt-1 pb-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Project</p>
                  <p className="font-normal capitalize mt-0.5">{request.project}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Environment</p>
                  <p className="font-normal capitalize mt-0.5">{request.environment}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Resource Name</p>
                  <p className="font-normal mt-0.5">{getServiceName(request.config as any) ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Module</p>
                  <p className="font-normal mt-0.5">{request.module ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Target repo</p>
                  <p className="font-normal mt-0.5">
                    {request.targetOwner && request.targetRepo
                      ? `${request.targetOwner}/${request.targetRepo}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Environment path</p>
                  <p className="font-normal mt-0.5">{request.targetEnvPath ?? "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground text-xs">Files</p>
                  <p className="font-normal mt-0.5">
                    {request.targetFiles?.length ? request.targetFiles.join(", ") : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Submitted</p>
                  <p className="font-normal mt-0.5">
                    {formatDate(request.createdAt ?? request.updatedAt ?? "")}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Cost estimate</p>
                  <p className="font-normal mt-0.5">
                    {request?.cost?.monthlyCost !== undefined
                      ? `Monthly: $${request.cost.monthlyCost.toFixed(2)}`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 h-full border-t border-border/50 pt-4 md:border-t-0 md:border-l md:border-border/50 md:ml-6 md:pl-6 md:pt-0 dark:border-slate-800/50 flex flex-col">
            <div className="px-5 pt-4 pb-4">
              <h3 className="text-base font-medium leading-none">Status Timeline</h3>
              <p className="text-xs text-muted-foreground mt-2">
                Lifecycle of this request
              </p>
            </div>
            <div className="px-5 pt-1 pb-4 flex flex-col flex-1 min-h-0">
              <div className="relative flex h-full flex-col gap-6">
                <div
                  className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-muted-foreground/25 dark:bg-muted-foreground/40"
                  aria-hidden
                />
                {steps.map((step) => {
                  const stepStateVal = stepState(step.key)
                  const isCurrent =
                    step.key === stepInfo.key && stepInfo.state === "pending"
                  const state: "pending" | "done" | "current" = isCurrent
                    ? "current"
                    : stepStateVal === "done"
                      ? "done"
                      : "pending"
                  const status = getStepCanonicalStatus(step.key, stepStateVal)
                  const displayLabel = getStepDisplayLabel(step.key, state, status)
                  const hidePulse =
                    (step.key === "approved" &&
                      state === "current" &&
                      !isApproving &&
                      actionProgress !== "approve") ||
                    (step.key === "merged" &&
                      state === "current" &&
                      mergeStatus !== "pending" &&
                      actionProgress !== "merge") ||
                    (step.key === "applied" &&
                      state === "current" &&
                      !isApplyingDerived &&
                      actionProgress !== "apply" &&
                      !isDestroying &&
                      actionProgress !== "destroy")
                  return (
                    <TimelineStep
                      key={step.key}
                      displayLabel={displayLabel}
                      status={status}
                      state={state}
                      timestamp={stepTimestamps[step.key]}
                      hidePulse={hidePulse}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {Array.isArray(request.previousPrs) && request.previousPrs.length > 0 && (
        <div className="rounded-lg bg-amber-50/80 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-100">
          This request has a newer revision. Older PR was superseded.
        </div>
      )}

      {(request.pullRequest || request.pr) && (
        <Card className="border-0 py-0 shadow-sm">
          <CardHeader className="px-5 pt-4 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Github className="size-4" />
                  {request.pullRequest?.title ?? "Pull Request"}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <Badge variant="info" className="font-normal text-xs">
                    {request.pr?.status ?? "open"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    PR #{request.pullRequest?.number ?? request.pr?.branch ?? ""}
                    {request.pr?.branch ? ` · ${request.pr?.branch ?? request.branchName ?? request.id}` : ""}
                  </span>
                  {(request.pullRequest?.url || request.pr?.url) && (
                    <a
                      href={request.pullRequest?.url ?? request.pr?.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <LinkIcon className="size-3.5" />
                      View on GitHub
                    </a>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-5 pt-2 pb-4 space-y-5">
            <TooltipProvider>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className={cn(
                        "h-9",
                        (!request ||
                          !isPlanReady ||
                          request.status === "approved" ||
                          request.status === "applied" ||
                          isMerged ||
                          isApplied ||
                          isDestroying ||
                          isDestroyed ||
                          isApplyingDerived ||
                          isFailed ||
                          isApproving) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={
                        !request ||
                        !isPlanReady ||
                        request.status === "approved" ||
                        request.status === "applied" ||
                        isMerged ||
                        isApplied ||
                        isDestroying ||
                        isDestroyed ||
                        isApplyingDerived ||
                        isFailed ||
                        isApproving
                      }
                      onClick={() => {
                        if (isApproving) return
                        setApproveStatus("idle")
                        setApproveModalOpen(true)
                      }}
                    >
                      {isApproving ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          Approving…
                        </span>
                      ) : (
                        "Approve"
                      )}
                    </Button>
                  </TooltipTrigger>
                  {(!isPlanReady || (requestStatus !== "pending" && requestStatus !== "planned" && requestStatus !== "approved")) && (
                    <TooltipContent>
                      {!isPlanReady ? "Wait for plan to be ready" : "Already approved, merged, applied, destroying, applying, or failed"}
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className={cn(
                        "h-9",
                        (!request ||
                          request.status !== "approved" ||
                          isMerged ||
                          mergeStatus === "pending" ||
                          isDestroying ||
                          isDestroyed ||
                          isFailed) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={
                        !request ||
                        request.status !== "approved" ||
                        isMerged ||
                        mergeStatus === "pending" ||
                        isDestroying ||
                        isDestroyed ||
                        isFailed
                      }
                      onClick={() => {
                        if (mergeStatus === "pending") return
                        setMergeStatus("idle")
                        setMergeError(null)
                        setMergeModalOpen(true)
                      }}
                    >
                      {mergeStatus === "pending" ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          Merging…
                        </span>
                      ) : (
                        "Merge"
                      )}
                    </Button>
                  </TooltipTrigger>
                  {requestStatus !== "approved" && (
                    <TooltipContent>
                      Approve first to enable merge
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className={cn(
                        "h-9",
                        (!isMerged || isApplied || isApplyingDerived || isDestroying || isDestroyed || isFailed) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={!isMerged || isApplied || isApplyingDerived || isDestroying || isDestroyed || isFailed}
                      onClick={() => {
                        setApplyStatus("idle")
                        setApplyModalOpen(true)
                      }}
                    >
                      {isApplyingDerived ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          Applying…
                        </span>
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </TooltipTrigger>
                  {!isMerged && (
                    <TooltipContent>
                      Merge first to enable apply
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      className={cn(
                        "h-9",
                        (isDestroying || isDestroyed || isApplying || !isApplied || !canDestroy) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={isDestroying || isDestroyed || isApplying || !isApplied || !canDestroy}
                      onClick={() => {
                        setDestroyStatus("idle")
                        setDestroyError(null)
                        setDestroyModalOpen(true)
                      }}
                    >
                      Destroy
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {!canDestroy
                      ? canDestroyData?.reason === "not_in_destroy_prod_allowlist"
                        ? "You're not allowed to destroy prod requests"
                        : canDestroyData?.reason === "requires_admin_role"
                          ? "Destroy requires admin role"
                          : "Destroy not permitted"
                      : "Destroy the resources for this request"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>

            {(isDestroying || isDestroyed || request.destroyRun) && (
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm text-foreground">
                <div className="flex items-center gap-2">
                  <Badge variant={isDestroyed ? "success" : "destructive"}>
                    {isDestroyed ? "Destroyed" : isDestroying ? "Destroying" : "Destroy triggered"}
                  </Badge>
                  {request.destroyRun?.url && (
                    <a
                      href={request.destroyRun.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <LinkIcon className="size-4" />
                      Destroy run
                    </a>
                  )}
                </div>
                {request.destroyRun?.runId && (
                  <p className="text-xs text-muted-foreground">Run ID: {request.destroyRun.runId}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground font-medium">Files Changed</p>
              {prFiles?.files?.length ? (
                <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm text-foreground shadow-sm">
                  {prFiles.files.map((f: any, idx: number) => {
                    const parsed = f.patch ? parsePatch(f.patch) : []
                    return (
                      <div key={`${f.filename}-${idx}`} className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">
                            {f.filename} ({f.status}) +{f.additions}/-{f.deletions}
                          </p>
                        </div>
                        {parsed.length > 0 ? (
                          <div className="overflow-hidden rounded-lg bg-muted/50 text-xs font-mono text-foreground">
                            {parsed.map((line, i) => (
                              <div
                                key={`${f.filename}-${idx}-${i}`}
                                className="grid grid-cols-[52px_1fr]"
                              >
                                <div
                                  className={`px-2 text-right text-[11px] ${lineNumberClass(line)}`}
                                >
                                  {line.new ?? ""}
                                </div>
                                <div className={`px-2 py-0.5 whitespace-pre-wrap ${lineClass(line.text)}`}>
                                  {line.text || "\u00a0"}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : prFilesError ? (
                <p className="text-sm text-muted-foreground">File changes unavailable.</p>
              ) : prFilesKey ? (
                <p className="text-sm text-muted-foreground">Loading file changes...</p>
              ) : (
                <p className="text-sm text-muted-foreground">File changes unavailable.</p>
              )}
            </div>

            <div className="mt-8 rounded-lg bg-muted/30 pl-4 pr-4 pb-4 shadow-sm">
              <div className="py-4 pr-0 flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">Terraform Plan Output</h3>
                {planRunning && (
                  <Badge variant="info" className="font-normal text-xs">
                    Planning…
                  </Badge>
                )}
                <p className="mt-0.5 w-full text-sm text-muted-foreground">
                  {planRunning
                    ? "Review plan output once the workflow completes"
                    : "Review plan output before approve or apply"}
                </p>
              </div>
              <div>
                {initialLoading && !request ? (
                  <p className="text-sm text-muted-foreground">Loading plan...</p>
                ) : planRunning ? (
                  <>
                    <div className="mt-3 min-h-[200px] overflow-hidden rounded-lg bg-muted/50 dark:bg-muted/30 border border-border/50 p-4 space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div
                          key={i}
                          className="h-3 rounded bg-muted-foreground/15 dark:bg-muted-foreground/20 animate-pulse"
                          style={{ width: i === 4 ? "60%" : i === 7 ? "40%" : "90%" }}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Terraform plan is running…
                    </p>
                  </>
                ) : planFetchingOutput ? (
                  <>
                    <div className="mt-3 min-h-[200px] overflow-hidden rounded-lg bg-muted/50 dark:bg-muted/30 border border-border/50 p-4 space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div
                          key={i}
                          className="h-3 rounded bg-muted-foreground/15 dark:bg-muted-foreground/20 animate-pulse"
                          style={{ width: i === 4 ? "60%" : i === 7 ? "40%" : "90%" }}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Fetching plan output…
                    </p>
                  </>
                ) : planFailed && !hasPlanText ? (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-destructive font-medium">Plan failed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The plan workflow did not complete successfully.
                    </p>
                    {planRunUrl && (
                      <a
                        className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary hover:underline"
                        href={planRunUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <LinkIcon className="size-3.5" />
                        View run on GitHub Actions
                      </a>
                    )}
                  </div>
                ) : !planRunId && !hasPlanText ? (
                  <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 dark:bg-muted/10 p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      Plan will appear once the workflow starts.
                    </p>
                  </div>
                ) : hasPlanText ? (
                  (() => {
                    const planTextRaw =
                      planOutput?.planText ??
                      request?.plan?.output ??
                      request.pullRequest?.planOutput ??
                      ""
                    const planTextStripped = stripPlanOutputToContent(planTextRaw)
                    const planTextDisplay = normalizePlanHeadings(stripLogTimestamps(planTextStripped))
                    const summary = parsePlanSummary(planTextStripped)
                    const hasSummary = summary.add > 0 || summary.change > 0 || summary.destroy > 0
                    return (
                      <>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {hasSummary && (
                              <>
                                {summary.add > 0 && (
                                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                    +{summary.add} to add
                                  </span>
                                )}
                                {summary.change > 0 && (
                                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                    ~{summary.change} to change
                                  </span>
                                )}
                                {summary.destroy > 0 && (
                                  <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                                    -{summary.destroy} to destroy
                                  </span>
                                )}
                              </>
                            )}
                            {(planOutput?.status || planOutput?.conclusion) && (
                              <span className="text-xs text-muted-foreground">
                                {planOutput.conclusion ?? planOutput.status}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {planOutput?.rawLogUrl && (
                              <a
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                href={planOutput.rawLogUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <LinkIcon className="size-3.5" />
                                Open plan logs
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => {
                                void navigator.clipboard.writeText(planTextStripped).catch(() => {})
                              }}
                            >
                              <Copy className="size-3.5" />
                              Copy
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={(e) => {
                                e.preventDefault()
                                setPlanLogExpanded((v) => !v)
                              }}
                            >
                              {planLogExpanded ? (
                                <>
                                  <ChevronUp className="size-3.5" />
                                  Collapse
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="size-3.5" />
                                  Expand
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "mt-3 overflow-y-auto rounded-lg bg-white p-4 border border-border/50 dark:bg-slate-950/80",
                            !planLogExpanded && "max-h-[480px]",
                          )}
                        >
                          <Code className="block bg-transparent p-0 text-sm leading-6 whitespace-pre-wrap font-mono text-foreground">
                            {planTextDisplay}
                          </Code>
                        </div>
                        {planFailed && (
                          <p className="mt-2 text-xs text-destructive">
                            Plan failed. See excerpt above or open full logs.
                          </p>
                        )}
                      </>
                    )
                  })()
                ) : (
                  <p className="text-sm text-muted-foreground">Plan not generated yet.</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-muted-foreground">Apply Output</p>
                <Button size="sm" variant="outline" onClick={() => setShowApplyOutput((v) => !v)} disabled={!applyRunId}>
                  {showApplyOutput ? "Hide" : "Load"}
                </Button>
                {applyOutput?.status && (
                  <p className="text-xs text-muted-foreground">
                    Status: {applyOutput.status}
                    {applyOutput.conclusion ? ` · Conclusion: ${applyOutput.conclusion}` : ""}
                  </p>
                )}
                {applyOutput?.conclusion === "failure" && (
                  <p className="text-xs text-destructive">Apply failed. See excerpt below or open full logs.</p>
                )}
              </div>
            {showApplyOutput ? (
              applyOutput?.applyText || request?.apply?.output ? (
                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/50 p-4 text-xs text-foreground whitespace-pre-wrap">
                  {applyOutput?.applyText ?? request?.apply?.output ?? ""}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No apply output yet.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Click Load to fetch apply output</p>
            )}
              {applyOutput?.rawLogUrl && (
                <a className="text-sm text-primary hover:underline" href={applyOutput.rawLogUrl} target="_blank" rel="noreferrer">
                  Open apply logs
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {request.cleanupPr && (
        <Card className="border-0 py-0 shadow-sm">
          <CardHeader className="px-5 pt-4 pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Github className="size-4" />
              Cleanup PR
            </CardTitle>
            <CardDescription className="text-xs">
              Removes the requested resources from code to avoid re-creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pt-1 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge
                  variant={
                    request.cleanupPr.merged
                      ? "success"
                      : request.cleanupPr.status === "open"
                        ? "info"
                        : "secondary"
                  }
                  className="w-fit"
                >
                  {request.cleanupPr.merged ? "Merged" : request.cleanupPr.status ?? "Pending"}
                </Badge>
              </div>
              {request.cleanupPr.url && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Link</p>
                  <a
                    href={request.cleanupPr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <LinkIcon className="size-4" />
                    {request.cleanupPr.url}
                  </a>
                </div>
              )}
              {request.cleanupPr.headBranch && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Branch</p>
                  <p className="font-medium">{request.cleanupPr.headBranch}</p>
                </div>
              )}
              {request.cleanupPr.number && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">PR #</p>
                  <p className="font-medium">{request.cleanupPr.number}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 py-0 shadow-sm">
        <CardHeader className="px-5 pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-medium">Lifecycle History</CardTitle>
              <CardDescription className="text-xs">Recent lifecycle events for this request</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/requests/${requestId}/audit-export`)
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    throw new Error(err?.error || "Failed to download audit log")
                  }
                  const blob = await res.blob()
                  const url = window.URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = `audit-${requestId}.json`
                  document.body.appendChild(a)
                  a.click()
                  window.URL.revokeObjectURL(url)
                  document.body.removeChild(a)
                } catch (err: any) {
                  console.error("[audit-export] error", err)
                  setActionError(err?.message || "Failed to download audit log")
                }
              }}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Download audit log
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-5 pt-1 pb-4">
          {logsLoading && sortedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading logs...</p>
          ) : sortedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lifecycle events recorded yet.</p>
          ) : (
            <ul className="space-y-4">
              {sortedEvents.map((evt: any, idx: number) => (
                <li
                  key={`${evt.timestamp ?? idx}-${idx}`}
                  className="border-b border-muted last:border-b-0 pt-4 pb-4 first:pt-0 last:pb-0 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-foreground">{formatEventName(evt.event)}</span>
                      <span className="text-xs text-muted-foreground">
                        {evt.actor ? `by ${evt.actor}` : "System"}
                        {evt.timestamp ? ` · ${formatDate(evt.timestamp)}` : ""}
                      </span>
                    </div>
                  </div>
                  {evt.data ? (
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {Object.entries(evt.data).map(([k, v]) => {
                        const entry = formatDataEntry(k, v, evt.data)
                        return (
                          <div key={k} className="rounded bg-muted/40 px-2 py-1">
                            <span className="font-medium text-foreground">{entry.label}: </span>
                            {entry.href ? (
                              <a
                                className="text-primary hover:underline"
                                href={entry.href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {entry.value}
                              </a>
                            ) : (
                              <span>{entry.value}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={updateModalOpen}
        onOpenChange={(val: boolean) => {
          if (!val) {
            setUpdateModalOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Update configuration</DialogTitle>
            <DialogDescription>Submit a patch for this request. We will open a new PR and supersede any open PR.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <details className="space-y-3 rounded-md bg-muted/30 p-3" open={false}>
              <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced (dangerous)</summary>
              <div className="text-xs text-muted-foreground">
                Raw JSON patch bypasses typed safety. Prefer using the assistant or form controls.
              </div>
              <Textarea
                className="min-h-[240px] font-mono text-xs"
                value={patchText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPatchText(e.target.value)}
                placeholder='{"field": "newValue"}'
              />
              {patchError && <div className="text-xs text-destructive">{patchError}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPatchText("{\n}")} disabled={patchSubmitting}>
                  Reset
                </Button>
                <Button onClick={handlePatchSubmit} disabled={patchSubmitting}>
                  {patchSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {patchSubmitting ? "Submitting..." : "Submit update"}
                </Button>
              </div>
            </details>
            <AssistantDrawer
              isOpen={assistantOpen}
              onClose={() => setAssistantOpen(false)}
              subheader={
                <>
                  <div>Chat with the assistant about this request.</div>
                  <div className="text-[11px] text-muted-foreground">
                    Working on: {request.module} • {request.project}/{request.environment}
                  </div>
                </>
              }
              width={drawerWidth}
            >
              <div className="h-full">
                {(() => {
                  const finalAssistantState = assistantStateOverride ?? panelAssistantState ?? request.assistant_state
                  if (typeof console !== "undefined") {
                    console.info("[page.tsx] SuggestionPanel props:", {
                      hasAssistantStateOverride: !!assistantStateOverride,
                      hasPanelAssistantState: !!panelAssistantState,
                      hasRequestAssistantState: !!request.assistant_state,
                      finalAssistantStateKeys: finalAssistantState ? Object.keys(finalAssistantState) : [],
                      patchKeys: finalAssistantState?.patch ? Object.keys(finalAssistantState.patch) : [],
                      suggestionsCount: finalAssistantState?.suggestions?.length ?? 0,
                      clarificationsCount: finalAssistantState?.clarifications?.length ?? 0,
                    })
                  }
                  return (
                    <SuggestionPanel
                      request={{
                        ...request,
                        assistant_state: finalAssistantState,
                      }}
                      requestId={request.id}
                      onRefresh={() => mutateStatus(undefined, true)}
                    />
                  )
                })()}
              <AssistantHelper
                context={{
                  project: request.project,
                  environment: request.environment,
                  module: request.module,
                  fieldsMeta:
                    moduleSchemas
                      ?.find((m: ModuleSchema) => m.type === request.module)
                      ?.fields?.filter((f: FieldMeta) => !(f.readOnly || f.immutable)) ??
                    [],
                  currentValues: request.config ?? {},
                }}
                  onAssistantState={(state) => {
                    setAssistantStateOverride(state)
                    setPanelAssistantState(state)
                }}
              />
              </div>
            </AssistantDrawer>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeModalOpen}
        onOpenChange={(val: boolean) => {
          if (!isApplying && !isApproving && !updatingBranch && !val) {
            setMergeModalOpen(false)
            setMergeStatus("idle")
            setMergeError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge pull request</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                {mergeStatus === "idle" && (
                  <div className="text-sm text-muted-foreground">
                    Are you sure you want to merge this pull request?
                  </div>
                )}
                {mergeStatus === "pending" && (
                  <div className="text-sm text-muted-foreground">Merging...</div>
                )}
                {mergeStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Pull request merged</div>
                )}
                {mergeStatus === "error" && (
                  <div className="space-y-2 text-sm">
                    <p className="text-destructive">
                      {mergeError ?? "Something went wrong. Please try again."}
                    </p>
                    {mergeNeedsUpdate && !mergeError?.includes("Merge conflict") && (
                      <p className="text-muted-foreground">
                        The branch is out of date with the base. Update it with the latest changes, then try merging again.
                      </p>
                    )}
                    {mergeError?.includes("Merge conflict") &&
                      (request.pullRequest?.url ?? request.pr?.url) && (
                        <a
                          href={request.pullRequest?.url ?? request.pr?.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <LinkIcon className="size-3.5" />
                          Open PR on GitHub to resolve conflicts
                        </a>
                      )}
                  </div>
                )}
              </div>
            </DialogDescription>
            {mergeStatus === "idle" && (
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMergeModalOpen(false)
                    setMergeStatus("idle")
                    setMergeError(null)
                  }}
                >
                  No
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void handleMerge()
                  }}
                >
                  Yes, merge
                </Button>
              </div>
            )}
            {mergeStatus === "error" && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {mergeNeedsUpdate && (
                  <Button
                    size="sm"
                    disabled={updatingBranch}
                    onClick={() => void handleUpdateBranch()}
                  >
                    {updatingBranch ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Updating branch…
                      </>
                    ) : (
                      "Update branch"
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updatingBranch}
                  onClick={() => {
                    setMergeModalOpen(false)
                    setMergeStatus("idle")
                    setMergeError(null)
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog
        open={approveModalOpen}
        onOpenChange={(val: boolean) => {
          if (!isApproving && !val) {
            setApproveModalOpen(false)
            setApproveStatus("idle")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approving request</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                {approveStatus === "idle" && (
                  <div className="text-sm text-muted-foreground">
                    Are you sure you want to approve this request?
                  </div>
                )}
                {approveStatus === "pending" && (
                  <div className="text-sm text-muted-foreground">Approving...</div>
                )}
                {approveStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Request approved</div>
                )}
                {approveStatus === "error" && (
                  <div className="text-sm text-red-700">
                    ❌ Something went wrong. Please try again.
                  </div>
                )}
              </div>
            </DialogDescription>
            {approveStatus === "idle" && (
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setApproveModalOpen(false)
                    setApproveStatus("idle")
                  }}
                >
                  No
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setApproveStatus("pending")
                    setIsApproving(true)
                    startActionProgress("approve")
                    void handleApprove()
                  }}
                >
                  Yes, approve
                </Button>
              </div>
            )}
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog
        open={applyModalOpen}
        onOpenChange={(val: boolean) => {
          if (!isApplying && !val) {
            setApplyModalOpen(false)
            setApplyStatus("idle")
            setActionError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deploying resource</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                {applyStatus === "idle" && (
                  <div className="text-sm text-muted-foreground">
                    Are you sure you want to apply these changes? This will run Terraform apply for this request.
                  </div>
                )}
                {applyStatus === "pending" && (
                  <div className="text-sm text-muted-foreground">Applying...</div>
                )}
                {applyStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Apply dispatched</div>
                )}
                {applyStatus === "error" && (
                  <div className="space-y-2 text-sm">
                    <p className="text-destructive">
                      {actionError ?? "Something went wrong. Please try again."}
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
            {applyStatus === "idle" && (
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setApplyModalOpen(false)
                    setApplyStatus("idle")
                  }}
                >
                  No
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    setApplyStatus("pending")
                    const ok = await handleApplyDispatch()
                    setApplyStatus(ok ? "success" : "error")
                    if (ok) {
                      setTimeout(() => setApplyModalOpen(false), 2000)
                    }
                  }}
                >
                  Yes, apply
                </Button>
              </div>
            )}
            {applyStatus === "error" && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setApplyModalOpen(false)
                    setApplyStatus("idle")
                    setActionError(null)
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog
        open={destroyModalOpen}
        onOpenChange={(val: boolean) => {
          if (destroyStatus !== "pending" && !isDestroying && !val) {
            setDestroyModalOpen(false)
            setDestroyStatus("idle")
            setDestroyError(null)
            setDestroyConfirmation("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy resources</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                {destroyStatus === "idle" && (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      This will permanently destroy all infrastructure created by this request.
                      This action is irreversible and may cause downtime or data loss.
                      Ensure backups and dependencies are handled before proceeding.
                    </p>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Type <span className="font-mono text-foreground">destroy</span> to confirm.
                      </p>
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={destroyConfirmation}
                        onChange={(e) => setDestroyConfirmation(e.target.value.toLowerCase())}
                        placeholder="destroy"
                      />
                    </div>
                  </div>
                )}
                {destroyStatus === "pending" && (
                  <div className="text-sm text-muted-foreground">Destroying...</div>
                )}
                {destroyStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Destroy dispatched</div>
                )}
                {destroyStatus === "error" && (
                  <div className="space-y-2 text-sm">
                    <p className="text-destructive">
                      {destroyError ?? "Something went wrong. Please try again."}
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
            {destroyStatus === "idle" && (
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDestroyModalOpen(false)
                    setDestroyStatus("idle")
                    setDestroyError(null)
                    setDestroyConfirmation("")
                  }}
                >
                  No
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={destroyConfirmation !== "destroy"}
                  onClick={async () => {
                    setDestroyStatus("pending")
                    const ok = await handleDestroy()
                    setDestroyStatus(ok ? "success" : "error")
                    if (ok) {
                      setTimeout(() => {
                        setDestroyModalOpen(false)
                        setDestroyStatus("idle")
                        setDestroyConfirmation("")
                      }, 2000)
                    }
                  }}
                >
                  Yes, destroy
                </Button>
              </div>
            )}
            {destroyStatus === "error" && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDestroyModalOpen(false)
                    setDestroyStatus("idle")
                    setDestroyError(null)
                    setDestroyConfirmation("")
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default React.memo(RequestDetailPage)
