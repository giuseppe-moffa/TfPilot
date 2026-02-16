"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, Github, Loader2, Link as LinkIcon, Wand2, Sparkles, Download } from "lucide-react"
import useSWR from "swr"
import { useParams } from "next/navigation"

import { useRequestStatus } from "@/hooks/use-request-status"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code } from "@/components/ui/code"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AssistantHelper } from "@/components/assistant-helper"
import { AssistantDrawer } from "@/components/assistant-drawer"
import { SuggestionPanel } from "@/components/suggestion-panel"
import { useAuth } from "@/app/providers"

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

const statusBadgeVariant: Record<
  "submitted" | "planned" | "merged" | "applied",
  "warning" | "info" | "success"
> = {
  submitted: "warning",
  planned: "warning",
  merged: "warning",
  applied: "success",
}

function lineClass(line: string) {
  const trimmed = line.trimStart()
  if (trimmed.startsWith("@@")) return "bg-muted text-foreground"
  if (trimmed.startsWith("+"))
    return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
  if (trimmed.startsWith("-"))
    return "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
  return "text-foreground"
}

function lineNumberClass(line: ParsedPatchLine) {
  if (line.kind === "meta") return "bg-muted text-muted-foreground"
  if (line.kind === "add")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
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
  const keys = ["name", "serviceName", "service_name", "bucket_name", "queue_name"]
  for (const key of keys) {
    const val = config[key]
    if (typeof val === "string" && val.trim()) return val
  }
  return null
}

function shallowEqual(a: any, b: any) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
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
  const [mergeStatus, setMergeStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [mergeModalOpen, setMergeModalOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [destroyModalOpen, setDestroyModalOpen] = React.useState(false)
  const [destroyStatus, setDestroyStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle")
  const [destroyError, setDestroyError] = React.useState<string | null>(null)
  const [destroyConfirmation, setDestroyConfirmation] = React.useState("")
  const [applyNote, setApplyNote] = React.useState("")
  const [showApplyOutput, setShowApplyOutput] = React.useState(false)
  const [initialRequest, setInitialRequest] = React.useState<any>(null)
  const [initialLoading, setInitialLoading] = React.useState<boolean>(true)
  const [statusSlice, setStatusSlice] = React.useState<any>(null)
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
  const optimisticUpdate = React.useCallback(
    (updates: Record<string, any>) => {
      mutateStatus(
        (prev: any) => (prev ? { ...prev, ...updates } : prev),
        false
      )
    },
    [mutateStatus]
  )

  React.useEffect(() => {
    if (!request) return
    const next = {
      status: request.status,
      statusDerivedAt: request.statusDerivedAt,
      planRun: request.planRun,
      applyRun: request.applyRun,
      approval: request.approval,
      pr: request.pr ?? request.pullRequest,
      plan: request.plan,
    }
    setStatusSlice((prev: any) => {
      if (shallowEqual(prev, next)) return prev
      return next
    })
  }, [request])

  React.useEffect(() => {
    // Set panelAssistantState from request only if we don't have a more recent assistant state
    // This ensures that fresh assistant responses take priority over persisted request data
    if (!panelAssistantState && !assistantStateOverride) {
      setPanelAssistantState(request?.assistant_state ?? null)
    }
  }, [request, panelAssistantState, assistantStateOverride])

  const memoStatusSlice = React.useMemo(() => statusSlice, [statusSlice])

  const planRunId = memoStatusSlice?.planRun?.runId ?? request?.planRun?.runId ?? request?.planRunId
  const applyRunId = memoStatusSlice?.applyRun?.runId ?? request?.applyRun?.runId ?? request?.applyRunId
  const prNumber = memoStatusSlice?.pr?.number ?? request?.pullRequest?.number ?? request?.pr?.number

  const planKey = planRunId && !(memoStatusSlice?.plan?.output) ? [`plan-output`, requestId, planRunId] : null
  const { data: planOutput } = useSWR(planKey, () => fetcher(`/api/github/plan-output?requestId=${requestId}`), {
    keepPreviousData: true,
    dedupingInterval: 5000,
    revalidateOnFocus: false,
  })

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

  async function handleApplyOnly() {
    if (!requestId || !memoStatusSlice || memoStatusSlice.status !== "approved") return
    setIsApplying(true)
    setApplyStatus("pending")
    setApplyModalOpen(true)
    try {
      await fetch(`/api/requests/${requestId}/apply`, { method: "POST" })
      await mutateStatus(undefined, true)
      setApplyStatus("success")
      setTimeout(() => setApplyModalOpen(false), 2000)
    } catch (err) {
      console.error("[request apply] error", err)
      setApplyStatus("error")
    } finally {
      setIsApplying(false)
    }
  }

  async function handleApplyDispatch(): Promise<boolean> {
    if (!requestId || requestStatus !== "merged") {
      return false
    }
    setIsApplying(true)
    setActionError(null)
    optimisticUpdate({ status: "applying", statusDerivedAt: new Date().toISOString() })
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
      setTimeout(() => setIsApplying(false), 2000)
    }
  }

  async function handleDestroy() {
    if (!requestId || isDestroying || isDestroyed) return
    setDestroyStatus("pending")
    setDestroyError(null)
    optimisticUpdate({ status: "destroying", statusDerivedAt: new Date().toISOString() })
    try {
      const res = await fetch(`/api/requests/${requestId}/destroy`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Failed to dispatch destroy")
      }
      await mutateStatus(undefined, true)
      setDestroyStatus("success")
      setTimeout(() => setDestroyModalOpen(false), 2000)
    } catch (err: any) {
      setDestroyStatus("error")
      setDestroyError(err?.message || "Failed to dispatch destroy")
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
    if (!requestId || !statusSlice || statusSlice.status !== "approved") return
    try {
      setMergeStatus("pending")
      optimisticUpdate({ status: "merged", statusDerivedAt: new Date().toISOString() })
      const res = await fetch("/api/github/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Failed to merge PR")
      }
      await mutateStatus(undefined, true)
      setMergeStatus("success")
      setTimeout(() => setMergeModalOpen(false), 2000)
    } catch (err) {
      console.error("[request merge] error", err)
      setMergeStatus("error")
    }
  }

  async function handleApprove() {
    if (!requestId || !memoStatusSlice || memoStatusSlice.status === "approved" || memoStatusSlice.status === "applied") return
    setIsApproving(true)
    setApproveStatus("pending")
    setApproveModalOpen(true)
    optimisticUpdate({ status: "approved", statusDerivedAt: new Date().toISOString() })
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Approve failed")
      await mutateStatus(undefined, true)
      setApproveStatus("success")
      setTimeout(() => setApproveModalOpen(false), 2000)
    } catch (err) {
      console.error("[request approve] error", err)
      setApproveStatus("error")
    } finally {
      setIsApproving(false)
    }
  }

  const requestStatus = memoStatusSlice?.status ?? request?.status ?? "created"
  const planSucceeded =
    memoStatusSlice?.planRun?.conclusion === "success" ||
    request?.planRun?.conclusion === "success" ||
    request?.planRun?.status === "completed"
  const planFailed =
    memoStatusSlice?.planRun?.conclusion === "failure" || request?.planRun?.conclusion === "failure"
  const prMerged =
    memoStatusSlice?.pr?.merged ??
    request?.pr?.merged ??
    request?.pullRequest?.merged ??
    request?.pullRequest?.open === false
  const applySucceeded =
    memoStatusSlice?.applyRun?.conclusion === "success" ||
    request?.applyRun?.conclusion === "success" ||
    requestStatus === "complete" ||
    requestStatus === "applied"
  const applyFailed =
    memoStatusSlice?.applyRun?.conclusion === "failure" || request?.applyRun?.conclusion === "failure"

  const applyRunning =
    requestStatus === "applying" ||
    memoStatusSlice?.applyRun?.status === "in_progress" ||
    request?.applyRun?.status === "in_progress"
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
    memoStatusSlice?.approval?.approved ||
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
    if (isApplied) {
      return {
        key: "applied" as const,
        state: "completed" as const,
        subtitle: "Deployment Completed",
      }
    }
    if (isMerged) {
      return {
        key: "merged" as const,
        state: "completed" as const,
        subtitle: "Pull request merged",
      }
    }
    if (isApproved) {
      return {
        key: "approved" as const,
        state: "completed" as const,
        subtitle: "Approved",
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
        return isApplied ? "done" : "pending"
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

  return (
    <div
      className="space-y-6 transition-[margin-right]"
      style={{ marginRight: assistantOpen ? drawerWidth : 0 }}
    >
      {hasDrift && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="destructive">Drift Detected</Badge>
                  {request.drift?.lastCheckedAt && (
                    <span className="text-xs text-muted-foreground">
                      Last checked: {new Date(request.drift.lastCheckedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground mb-2">
                  Infrastructure drift has been detected. Review the plan to see what has changed.
                </p>
                {request.drift?.summary && (
                  <p className="text-xs text-muted-foreground mb-2">{request.drift.summary}</p>
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
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl font-semibold flex items-center gap-2">
                  <span>Request {request.id}</span>
                  {isDestroyed && <Badge variant="secondary">Destroyed</Badge>}
                  {isDestroying && !isDestroyed && <Badge variant="secondary">Destroying</Badge>}
                  {request.revision ? <Badge variant="secondary">Rev {request.revision}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  Overview of request metadata and execution timeline
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setUpdateModalOpen(true)}>
                  Update Configuration
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAssistantOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" /> Assistant
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Project</p>
              <p className="text-base font-medium capitalize">{request.project}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Environment</p>
              <p className="text-base font-medium capitalize">
                {request.environment}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Resource Name</p>
              <p className="text-base font-medium">{getServiceName(request.config as any) ?? "—"}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Module</p>
              <p className="text-base font-medium">{request.module ?? "—"}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Target repo</p>
              <p className="text-base font-medium">
                {request.targetOwner && request.targetRepo
                  ? `${request.targetOwner}/${request.targetRepo}`
                  : "—"}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Environment path</p>
              <p className="text-base font-medium">{request.targetEnvPath ?? "—"}</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <p className="text-sm text-muted-foreground">Files</p>
              <p className="text-base font-medium">
                {request.targetFiles?.length
                  ? request.targetFiles.join(", ")
                  : "—"}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Submitted</p>
              <p className="text-base font-medium">
                {formatDate(request.createdAt ?? request.updatedAt ?? "")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-lg font-semibold">Status Timeline</CardTitle>
            <CardDescription>
              Track the lifecycle of this infrastructure request
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-6">
              {steps.map((step, idx) => {
                const state = stepState(step.key)
                const isDone = state === "done"
                const badgeVariant = isDone ? "success" : "warning"
                return (
                  <div key={step.key} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex size-9 items-center justify-center rounded-full border ${
                          isDone
                            ? "border-success/30 bg-success/15 text-success"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="size-5 text-success" />
                        ) : (
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {idx < steps.length - 1 && (
                        <Separator
                          className="my-2 h-full w-px flex-1 bg-border"
                          orientation="vertical"
                        />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-medium">{step.label}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {stepSubtitle(step.key, state)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {Array.isArray(request.previousPrs) && request.previousPrs.length > 0 && (
        <div className="rounded-md border border-border bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          This request has a newer revision. Older PR was superseded.
        </div>
      )}

      {(request.pullRequest || request.pr) && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Github className="size-5" />
              GitHub Pull Request
            </CardTitle>
            <CardDescription>
              Review the proposed changes linked to this request
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">PR Title</p>
                <p className="font-medium">
                  {request.pullRequest?.title ?? "N/A"}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    PR #{request.pullRequest?.number ?? request.pr?.branch ?? ""}
                  </span>
                  {(request.pullRequest?.url || request.pr?.url) && (
                    <a
                      href={request.pullRequest?.url ?? request.pr?.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <LinkIcon className="size-4" />
                      View on GitHub
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">PR Branch</p>
                <p className="font-medium">
                  {request.pr?.branch ?? request.branchName ?? request.id}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge variant="info" className="w-fit">
                  {request.pr?.status ?? "open"}
                </Badge>
              </div>
              {(request.pullRequest?.url || request.pr?.url) && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Link</p>
                  <a
                    href={request.pullRequest?.url ?? request.pr?.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <LinkIcon className="size-4" />
                    {request.pullRequest?.url ?? request.pr?.url}
                  </a>
                </div>
              )}
            </div>

            <TooltipProvider>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className={cn(
                        "h-9",
                        (!statusSlice ||
                          statusSlice.status === "approved" ||
                          statusSlice.status === "applied" ||
                          isMerged ||
                          isApplied ||
                          isDestroying ||
                          isDestroyed ||
                          isApplyingDerived ||
                          isFailed) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={
                        !statusSlice ||
                        statusSlice.status === "approved" ||
                        statusSlice.status === "applied" ||
                        isMerged ||
                        isApplied ||
                        isDestroying ||
                        isDestroyed ||
                        isApplyingDerived ||
                        isFailed
                      }
                      onClick={() => {
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
                  {requestStatus !== "pending" && requestStatus !== "planned" && (
                    <TooltipContent>
                      Already approved, merged, applied, destroying, applying, or failed
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className={cn(
                        "h-9",
                        (!statusSlice || statusSlice.status !== "approved" || isMerged || isDestroying || isDestroyed || isFailed) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
                      )}
                      disabled={!statusSlice || statusSlice.status !== "approved" || isMerged || isDestroying || isDestroyed || isFailed}
                      onClick={() => {
                        setMergeStatus("idle")
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
              <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
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
              <p className="text-sm font-medium text-foreground">Files Changed</p>
              {prFiles?.files?.length ? (
                <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground">
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
                          <div className="overflow-hidden rounded border border-border bg-card text-xs font-mono text-foreground">
                            {parsed.map((line, i) => (
                              <div
                                key={`${f.filename}-${idx}-${i}`}
                                className="grid grid-cols-[52px_52px_1fr]"
                              >
                                <div
                                  className={`px-2 text-right text-[11px] ${lineNumberClass(line)}`}
                                >
                                  {line.old ?? ""}
                                </div>
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

            <div className="space-y-2">
              <p className="text-sm font-medium">Terraform Plan Output</p>
              {initialLoading && !request ? (
                <p className="text-sm text-muted-foreground">Loading plan...</p>
              ) : planOutput?.planText || request?.plan?.output || request.pullRequest?.planOutput ? (
                <div className="rounded-lg border border-border bg-card text-foreground">
                  <Code className="bg-transparent p-4 text-sm leading-6 whitespace-pre-wrap text-foreground">
                    {normalizePlanHeadings(
                      stripLogTimestamps(
                        planOutput?.planText ??
                          request?.plan?.output ??
                          request.pullRequest?.planOutput ??
                          "",
                      ),
                    )}
                  </Code>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Plan not generated yet.</p>
              )}
              {planOutput?.status && (
                <p className="text-xs text-muted-foreground">
                  Status: {planOutput.status}
                  {planOutput.conclusion ? ` · Conclusion: ${planOutput.conclusion}` : ""}
                </p>
              )}
              {planOutput?.conclusion === "failure" && (
                <p className="text-xs text-destructive">Plan failed. See excerpt above or open full logs.</p>
              )}
              {planOutput?.rawLogUrl && (
                <a className="text-sm text-primary hover:underline" href={planOutput.rawLogUrl} target="_blank" rel="noreferrer">
                  Open plan logs
                </a>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Apply Output</p>
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
                <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap">
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
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Github className="size-5" />
              Cleanup PR
            </CardTitle>
            <CardDescription>
              Removes the requested resources from code to avoid re-creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
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

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                Lifecycle History
              </CardTitle>
              <CardDescription>Recent lifecycle events for this request</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
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
              <Download className="mr-2 h-4 w-4" />
              Download audit log
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {logsLoading && sortedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading logs...</p>
          ) : sortedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lifecycle events recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {sortedEvents.map((evt: any, idx: number) => (
                <div
                  key={`${evt.timestamp ?? idx}-${idx}`}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-medium">{formatEventName(evt.event)}</span>
                      <span className="text-xs text-muted-foreground">
                        {evt.actor ? `by ${evt.actor}` : "System"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {evt.timestamp ? formatDate(evt.timestamp) : ""}
                    </span>
                  </div>
                  {evt.data ? (
                    <div className="mt-2 space-y-1 text-xs text-foreground">
                      {Object.entries(evt.data).map(([k, v]) => {
                        const entry = formatDataEntry(k, v, evt.data)
                        return (
                          <div key={k} className="rounded bg-muted px-2 py-1">
                            <span className="font-medium">{entry.label}: </span>
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
                              <span className="text-muted-foreground">{entry.value}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
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
            <details className="space-y-3 rounded-md border border-border bg-card p-3" open={false}>
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
          if (!isApplying && !isApproving && !val) {
            setMergeModalOpen(false)
            setMergeStatus("idle")
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Merging...
                  </div>
                )}
                {mergeStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Pull request merged</div>
                )}
                {mergeStatus === "error" && (
                  <div className="text-sm text-red-700">
                    ❌ Something went wrong. Please try again.
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Approving...
                  </div>
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
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Applying changes</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                {applyStatus === "idle" && (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-100">
                      This will run Terraform apply and create the resource in core/dev. Confirm you want to apply to this environment.
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground" htmlFor="apply-note">
                        Optional note for this apply (reason/intent)
                      </label>
                      <textarea
                        id="apply-note"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                        rows={3}
                        value={applyNote}
                        onChange={(e) => setApplyNote(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {applyStatus === "pending" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Applying...
                  </div>
                )}
                {applyStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Changes applied</div>
                )}
                {applyStatus === "error" && (
                  <div className="text-sm text-red-700">
                    ❌ Something went wrong. Please try again.
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
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog
        open={destroyModalOpen}
        onOpenChange={(val: boolean) => {
          if (!isDestroying && !val) {
            setDestroyModalOpen(false)
            setDestroyStatus("idle")
            setDestroyError(null)
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Destroying...
                  </div>
                )}
                {destroyStatus === "success" && (
                  <div className="text-sm text-emerald-700">✅ Destroy dispatched</div>
                )}
                {destroyStatus === "error" && (
                  <div className="text-sm text-red-700">
                    ❌ {destroyError || "Something went wrong. Please try again."}
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
                  onClick={() => {
                    setDestroyStatus("pending")
                    void handleDestroy()
                  }}
                >
                  Yes, destroy
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
