"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, Github, Loader2, Link as LinkIcon } from "lucide-react"
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
import { Code } from "@/components/ui/code"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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
  const [showApplyOutput, setShowApplyOutput] = React.useState(false)
  const [initialRequest, setInitialRequest] = React.useState<any>(null)
  const [initialLoading, setInitialLoading] = React.useState<boolean>(true)
  const [statusSlice, setStatusSlice] = React.useState<any>(null)

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

  const { request, mutate: mutateStatus } = useRequestStatus(requestId, initialRequest)

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

  async function handleApplyDispatch() {
    if (!requestId || !memoStatusSlice || memoStatusSlice.status !== "merged") return
    setIsApplying(true)
    setActionError(null)
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch apply")
    } finally {
      setIsApplying(false)
    }
  }

  async function handleMerge() {
    if (!requestId || !statusSlice || statusSlice.status !== "approved") return
    try {
      setMergeStatus("pending")
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

  const requestStatus = memoStatusSlice?.status ?? request?.status ?? "created"
  const isApplied = requestStatus === "complete" || requestStatus === "applied"
  const isMerged = requestStatus === "merged" || requestStatus === "applying" || isApplied
  const isPlanReady =
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
  const isFailed = requestStatus === "failed"

  function computeStepInfo() {
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
        return state === "done" ? "Plan ready" : "Waiting for plan"
      case "approved":
        return state === "done" ? "Approved" : "Waiting for approval"
      case "merged":
        return state === "done" ? "Pull request merged" : "Waiting for PR merge"
      case "applied":
        return state === "done" ? "Deployment Completed" : "Waiting for apply"
      default:
        return "Pending"
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-xl font-semibold">
              Request {request.id}
            </CardTitle>
            <CardDescription>
              Overview of request metadata and execution timeline.
            </CardDescription>
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
              <p className="text-sm text-muted-foreground">Service</p>
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
              Track the lifecycle of this infrastructure request.
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

      {(request.pullRequest || request.pr) && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Github className="size-5" />
              GitHub Pull Request
            </CardTitle>
            <CardDescription>
              Review the proposed changes linked to this request.
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
                      disabled={
                        !statusSlice ||
                        statusSlice.status === "approved" ||
                        statusSlice.status === "applied"
                      }
                      onClick={() => {
                        setApproveStatus("idle")
                        setApproveModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90",
                        ((!statusSlice) ||
                          statusSlice.status === "approved" ||
                          statusSlice.status === "applied") &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-60"
                      )}
                    >
                      Approve
                    </Button>
                  </TooltipTrigger>
                  {requestStatus !== "pending" && requestStatus !== "planned" && (
                    <TooltipContent>
                      Already approved or applied
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      disabled={!statusSlice || statusSlice.status !== "approved" || isMerged}
                      onClick={() => {
                        setMergeStatus("idle")
                        setMergeModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90",
                        (!statusSlice || statusSlice.status !== "approved" || isMerged) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-60"
                      )}
                    >
                      Merge
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
                      disabled={!isMerged || isApplied || isApplying}
                      onClick={() => {
                        setApplyStatus("idle")
                        setApplyModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90",
                        (!isMerged || isApplied || isApplying) &&
                          "cursor-not-allowed bg-muted text-muted-foreground opacity-60"
                      )}
                    >
                      Apply
                    </Button>
                  </TooltipTrigger>
                  {!isMerged && (
                    <TooltipContent>
                      Merge first to enable apply
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </TooltipProvider>

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
              <p className="text-sm text-muted-foreground">Click Load to fetch apply output.</p>
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
                  className="bg-blue-500 text-white hover:bg-blue-600"
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
                  className="bg-emerald-500 text-white hover:bg-emerald-600"
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
                  <div className="text-sm text-muted-foreground">
                    Are you sure you want to apply this request?
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
                  className="bg-gray-900 text-white hover:bg-gray-800"
                  onClick={() => {
                    setApplyStatus("pending")
                    void handleApplyOnly()
                  }}
                >
                  Yes, apply
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
