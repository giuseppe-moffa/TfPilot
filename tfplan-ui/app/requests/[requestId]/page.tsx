"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, Github, Loader2, Link as LinkIcon } from "lucide-react"
import { useParams } from "next/navigation"

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
  if (line.trimStart().startsWith("+")) return "bg-emerald-50 text-emerald-800"
  if (line.trimStart().startsWith("-")) return "bg-red-50 text-red-800"
  return "text-slate-800"
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

export default function RequestDetailPage() {
  const routeParams = useParams()
  const requestId =
    typeof routeParams?.requestId === "string"
      ? routeParams.requestId
      : Array.isArray(routeParams?.requestId)
        ? routeParams?.requestId[0]
        : undefined

  const [isLoading, setIsLoading] = React.useState(true)
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
  const [request, setRequest] = React.useState<{
    id: string
    project: string
    environment: string
    module?: string
    config?: Record<string, unknown>
    status:
      | "created"
      | "pr_open"
      | "planning"
      | "plan_ready"
      | "awaiting_approval"
      | "merged"
      | "applying"
      | "complete"
      | "failed"
      | "pending"
      | "planned"
      | "approved"
      | "applied"
    createdAt?: string
    updatedAt?: string
    prUrl?: string
    branchName?: string
    workflowRunId?: number
    plan?: { diff?: string }
    pullRequest?: {
      title: string
      url: string
      number: number
      files?: Array<{ path: string; diff: string }>
      planOutput?: string
      status?: string
    }
    pr?: { url: string; branch: string; status: string }
  } | null>(null)

  const refreshRequest = React.useCallback(async () => {
    if (!requestId) return
    setIsLoading(true)
    try {
      const res = await fetch("/api/requests")
      if (!res.ok) throw new Error("Failed to fetch request")
      const data = (await res.json()) as {
        success: boolean
        requests?: Array<{
          id: string
          project: string
          environment: string
          status?: "pending" | "planned" | "approved" | "applied"
          receivedAt?: string
          updatedAt?: string
          plan?: { diff?: string }
          pullRequest?: {
            title: string
            url: string
            number: number
            files?: Array<{ path: string; diff: string }>
            planOutput?: string
          }
          pr?: { url: string; branch: string; status: string }
        }>
      }
      const match = data.requests?.find((r) => r.id === requestId)
      setRequest(
        match
          ? {
              id: match.id,
              project: match.project,
              environment: match.environment,
              status: match.status ?? "pending",
              createdAt: match.receivedAt,
              updatedAt: match.updatedAt,
              plan: match.plan,
              pullRequest: match.pullRequest,
              pr: match.pr,
            }
          : null
      )
    } catch (err) {
      console.error("[request detail] fetch error", err)
      setRequest(null)
    } finally {
      setIsLoading(false)
    }
  }, [requestId])

  React.useEffect(() => {
    void refreshRequest()
  }, [refreshRequest])

  React.useEffect(() => {
    if (!requestId) return
    const id = setInterval(() => {
      void refreshRequest()
    }, 5000)
    return () => clearInterval(id)
  }, [refreshRequest, requestId])

  async function handleApproveApply() {
    if (!requestId || !request || request.status !== "planned") return
    setIsApplying(true)
    setApplyStatus("pending")
    setApplyModalOpen(true)
    const prevStatus = request.status
    setRequest({ ...request, status: "applied" })
    try {
      await fetch(`/api/requests/${requestId}/approve`, { method: "POST" })
      setApplyStatus("success")
      setTimeout(() => setApplyModalOpen(false), 2000)
    } catch (err) {
      console.error("[request approve] error", err)
      setRequest({ ...request, status: prevStatus })
      setApplyStatus("error")
    } finally {
      setIsApplying(false)
    }
  }

  async function handleApplyOnly() {
    if (!requestId || !request || request.status !== "approved") return
    setIsApplying(true)
    setApplyStatus("pending")
    setApplyModalOpen(true)
    const prevStatus = request.status
    setRequest({ ...request, status: "applied" })
    try {
      await fetch(`/api/requests/${requestId}/apply`, { method: "POST" })
      await refreshRequest()
      setApplyStatus("success")
      setTimeout(() => setApplyModalOpen(false), 2000)
    } catch (err) {
      console.error("[request apply] error", err)
      setRequest({ ...request, status: prevStatus })
      setApplyStatus("error")
    } finally {
      setIsApplying(false)
    }
  }

  async function handleApplyDispatch() {
    if (!requestId || !request || request.status !== "merged") return
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
      setRequest({ ...(request as any), status: "applying" })
      await refreshRequest()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch apply")
    } finally {
      setIsApplying(false)
    }
  }

  async function handleMerge() {
    if (!requestId || !request || request.status !== "approved") return
    try {
      setMergeStatus("pending")
      const updated = {
        ...request,
        pullRequest: {
          ...request.pullRequest,
          status: "merged",
        },
        timeline: [
          ...(Array.isArray((request as any).timeline) ? (request as any).timeline : []),
          {
            step: "Merged",
            status: "Complete",
            message: "Pull request merged",
            at: new Date().toISOString(),
          },
        ],
      }
      setRequest(updated as any)
      setMergeStatus("success")
      setTimeout(() => setMergeModalOpen(false), 2000)
    } catch (err) {
      console.error("[request merge] error", err)
      setMergeStatus("error")
    }
  }

  async function handleApprove() {
    if (!requestId || !request || request.status === "approved" || request.status === "applied") return
    setIsApproving(true)
    setApproveStatus("pending")
    setApproveModalOpen(true)
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Approve failed")
      await refreshRequest()
      setApproveStatus("success")
      setTimeout(() => setApproveModalOpen(false), 2000)
    } catch (err) {
      console.error("[request approve] error", err)
      setApproveStatus("error")
    } finally {
      setIsApproving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading request...
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-xl text-center">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold">
              Request {requestId ?? "unknown"}
            </CardTitle>
            <CardDescription>
              Request created. Waiting for plan...
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            We&apos;re preparing the plan details for this request. Refresh
            shortly to see updates.
          </CardContent>
        </Card>
      </div>
    )
  }

  const requestStatus = request.status
  const isApplied = requestStatus === "complete" || requestStatus === "applied"
  const isMerged = requestStatus === "merged" || requestStatus === "applying" || isApplied
  const isPlanReady =
    requestStatus === "plan_ready" ||
    requestStatus === "planned" ||
    requestStatus === "approved" ||
    requestStatus === "awaiting_approval" ||
    isMerged ||
    isApplied
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
    if (isPlanReady) {
      return {
        key: "planned" as const,
        state: "pending" as const,
        subtitle: "Waiting for PR merge",
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
            <p className="text-sm text-muted-foreground">Submitted</p>
            <p className="text-base font-medium">
              {formatDate(request.createdAt ?? request.updatedAt ?? "")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-lg font-semibold">Actions</CardTitle>
          <CardDescription>Manage merge and apply steps for this request.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          {(request.pullRequest?.url || request.prUrl) && (
            <Button asChild variant="outline" size="sm">
              <Link href={request.pullRequest?.url ?? request.prUrl!} target="_blank" rel="noreferrer">
                View PR
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" disabled>
            Merge (requires plan_ready)
          </Button>
          <Button
            size="sm"
            onClick={handleApplyDispatch}
            disabled={request.status !== "merged" || isApplying}
          >
            {isApplying ? "Applying..." : "Apply"}
          </Button>
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
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
                          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      <CheckCircle2 className="size-5" />
                    </div>
                    {idx < steps.length - 1 && (
                      <Separator
                        className="my-2 h-full w-px flex-1 bg-slate-200"
                        orientation="vertical"
                      />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium">{step.label}</p>
                      <Badge variant={badgeVariant}>
                        {isDone ? "Completed" : "Pending"}
                      </Badge>
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
                  {request.pr?.branch ?? `req-${request.id}`}
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
                        isLoading ||
                        request.status === "approved" ||
                        request.status === "applied"
                      }
                      onClick={() => {
                        setApproveStatus("idle")
                        setApproveModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-emerald-500 px-3 py-1.5 text-white hover:bg-emerald-600",
                        (isLoading ||
                          request.status === "approved" ||
                          request.status === "applied") &&
                          "cursor-not-allowed bg-gray-100 text-emerald-500 opacity-60"
                      )}
                    >
                      Approve
                    </Button>
                  </TooltipTrigger>
                  {request.status !== "pending" && request.status !== "planned" && (
                    <TooltipContent>
                      Already approved or applied
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      disabled={request.status !== "approved" || isMerged}
                      onClick={() => {
                        setMergeStatus("idle")
                        setMergeModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-blue-500 px-3 py-1.5 text-white hover:bg-blue-600",
                        (request.status !== "approved" || isMerged) &&
                          "cursor-not-allowed bg-gray-100 text-blue-500 opacity-60"
                      )}
                    >
                      Merge
                    </Button>
                  </TooltipTrigger>
                  {request.status !== "approved" && (
                    <TooltipContent>
                      Approve first to enable merge
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                          disabled={!isMerged || isApplied}
                      onClick={() => {
                        setApplyStatus("idle")
                        setApplyModalOpen(true)
                      }}
                      className={cn(
                        "cursor-pointer rounded-md bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-800",
                            (!isMerged || isApplied || isApplying) &&
                          "cursor-not-allowed bg-gray-100 text-gray-700 opacity-60"
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

            {request.pullRequest?.files?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">File Changes</p>
                <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
                  {request.pullRequest.files.map((file) => (
                    <div key={file.path} className="space-y-1">
                      <p className="font-medium text-slate-900">{file.path}</p>
                      <div className="rounded bg-slate-900 px-3 py-2 text-slate-100">
                        <code className="whitespace-pre-line text-xs">
                          {file.diff}
                        </code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No file changes listed.</p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">Terraform Plan Output</p>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading plan...</p>
              ) : request.pullRequest?.planOutput || request.plan?.diff ? (
                <div className="rounded-lg border bg-slate-950 text-slate-100">
                  <Code className="bg-transparent p-4 text-sm leading-6 whitespace-pre-wrap">
                    {request.pullRequest?.planOutput ?? request.plan?.diff ?? ""}
                  </Code>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Plan not generated yet.</p>
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
