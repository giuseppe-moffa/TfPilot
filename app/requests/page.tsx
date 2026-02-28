"use client"

import * as React from "react"
import useSWR from "swr"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadSortable,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatusIndicator } from "@/components/status/StatusIndicator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Eye, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAwsConnection } from "../providers"
import { patchRequestCache } from "@/hooks/use-request"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { normalizeRequestStatus } from "@/lib/status/status-config"
import { getStatusLabel } from "@/lib/status/status-config"

type RequestRow = {
  id: string
  project: string
  environment: string
  service?: string
  module?: string
  status?: string
  pullRequest?: { status?: string }
  createdAt?: string
  config?: Record<string, unknown>
  drift?: {
    status?: "none" | "detected"
    lastCheckedAt?: string
    runId?: number
    runUrl?: string
    summary?: string
  }
}

type DisplayStatus = "submitted" | "planned" | "approved" | "merged" | "applied" | "destroyed"

/** Status in list is derived server-side from currentAttempt only (deriveLifecycleStatus). Active/Failed/Destroyed reflect current attempt only. */
function computeStatus(row: RequestRow): {
  step: DisplayStatus
  state: "completed" | "pending"
} {
  const status = row.status ?? "pending"
  if (status === "destroyed") {
    return { step: "destroyed", state: "completed" }
  }
  if (status === "destroying") {
    return { step: "destroyed", state: "pending" }
  }
  const isApplied = status === "applied" || status === "complete"
  const isMerged =
    status === "merged" || status === "applying" || isApplied || row.pullRequest?.status === "merged"
  const isApproved = status === "approved" || status === "awaiting_approval" || isMerged
  const isPlanReady = status === "planned" || status === "plan_ready" || isApproved || isMerged || isApplied

  if (isApplied) return { step: "applied", state: "completed" }
  if (isMerged) return { step: "merged", state: "completed" }
  if (isApproved) return { step: "approved", state: "completed" }
  if (isPlanReady) return { step: "planned", state: "completed" }
  return { step: "submitted", state: "pending" }
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  return `${date} · ${time}`
}

/** Min ms between sync batches for the same visible set to avoid hammering. */
const VISIBLE_SYNC_DEBOUNCE_MS = 25_000
/** Interval to re-sync visible rows so status (e.g. planning → plan_ready) updates without opening detail. */
const VISIBLE_SYNC_INTERVAL_MS = 30_000

function SkeletonRow() {
  return (
    <TableRow>
      {[...Array(8)].map((_, idx) => (
        <TableCell key={idx}>
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  )
}

export default function RequestsPage() {
  const fetcher = React.useCallback(async (url: string) => {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) throw new Error("Failed to fetch requests")
    return res.json()
  }, [])

  const swr = useSWR("/api/requests", fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30_000,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  })
  const { data, error, mutate: mutateList } = swr
  const isValidating = (swr as any).isValidating ?? false

  const [requests, setRequests] = React.useState<RequestRow[]>([])
  type DatasetMode = "active" | "drifted" | "destroyed" | "all"
  const [datasetMode, setDatasetMode] = React.useState<DatasetMode>("active")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [envFilter, setEnvFilter] = React.useState<"all" | "dev" | "prod">("all")
  const [moduleFilter, setModuleFilter] = React.useState<string>("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")
  const [sortKey, setSortKey] = React.useState<"id" | "project" | "module" | "service" | "environment" | "status" | "createdAt">("createdAt")
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc")
  const { isConnected } = useAwsConnection()

  const handleSort = React.useCallback((key: typeof sortKey) => {
    setSortKey(key)
    setSortDirection((d) => (sortKey === key ? (d === "asc" ? "desc" : "asc") : "desc"))
  }, [sortKey])

  const sortDir = (key: typeof sortKey) => (sortKey === key ? sortDirection : null)

  React.useEffect(() => {
    const rows =
      data?.requests?.map((r: any) => ({
        id: r.id,
        project: r.project,
        environment: r.environment,
        module: r.module,
        service:
          typeof r.config?.["name"] === "string" ? (r.config["name"] as string) : undefined,
        status: deriveLifecycleStatus(r) ?? ("pending" as const),
        createdAt: r.receivedAt,
        config: r.config,
        pullRequest: r.pullRequest,
        drift: r.drift,
      })) ?? []
    setRequests(rows)
  }, [data])

  const moduleOptions = React.useMemo(() => {
    const set = new Set<string>()
    requests.forEach((r) => {
      if (r.module) set.add(r.module)
    })
    return Array.from(set)
  }, [requests])

  const projectOptions = React.useMemo(() => {
    const set = new Set<string>()
    requests.forEach((r) => {
      if (r.project) set.add(r.project)
    })
    return Array.from(set)
  }, [requests])

  const isInitialLoading = !data && !error
  const isRefreshing = isValidating && !!data

  const filteredRequests = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const filtered = requests.filter((row) => {
      const status = row.status
      const isFullyDestroyed = status === "destroyed"
      const isInDestroyedTab = status === "destroyed" || status === "destroying"
      if (datasetMode === "destroyed" && !isInDestroyedTab) return false
      if (datasetMode === "active" && isFullyDestroyed) return false
      if (datasetMode === "drifted" && row.drift?.status !== "detected") return false

      if (envFilter !== "all" && row.environment?.toLowerCase() !== envFilter) return false
      if (moduleFilter !== "all" && row.module !== moduleFilter) return false
      if (projectFilter !== "all" && row.project !== projectFilter) return false

      if (!term) return true
      const haystack = [
        row.id,
        row.project,
        row.environment,
        row.module,
        row.service,
        row.config && typeof row.config === "object" ? JSON.stringify(row.config) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })

    const dir = sortDirection === "asc" ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case "id":
          return dir * (a.id ?? "").localeCompare(b.id ?? "")
        case "project":
          return dir * (a.project ?? "").localeCompare(b.project ?? "")
        case "module":
          return dir * (a.module ?? "N/A").localeCompare(b.module ?? "N/A")
        case "service":
          return dir * (a.service ?? "N/A").localeCompare(b.service ?? "N/A")
        case "environment":
          return dir * (a.environment ?? "").localeCompare(b.environment ?? "")
        case "status": {
          const canonicalA = normalizeRequestStatus(a.status, {
            isDestroyed: a.status === "destroyed",
            isDestroying: a.status === "destroying",
          })
          const canonicalB = normalizeRequestStatus(b.status, {
            isDestroyed: b.status === "destroyed",
            isDestroying: b.status === "destroying",
          })
          return dir * getStatusLabel(canonicalA).localeCompare(getStatusLabel(canonicalB))
        }
        case "createdAt": {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return dir * (aTime - bTime)
        }
        default:
          return 0
      }
    })
  }, [requests, datasetMode, envFilter, moduleFilter, projectFilter, searchTerm, sortKey, sortDirection])

  const visibleIdsKey = React.useMemo(
    () => filteredRequests.map((r) => r.id).join(","),
    [filteredRequests]
  )
  const lastVisibleSyncRef = React.useRef<{ key: string; at: number }>({ key: "", at: 0 })
  const [visibleSyncTick, setVisibleSyncTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setVisibleSyncTick((t) => t + 1), VISIBLE_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  React.useEffect(() => {
    if (!visibleIdsKey) return
    const now = Date.now()
    if (
      lastVisibleSyncRef.current.key === visibleIdsKey &&
      now - lastVisibleSyncRef.current.at < VISIBLE_SYNC_DEBOUNCE_MS
    )
      return
    lastVisibleSyncRef.current = { key: visibleIdsKey, at: now }
    const ids = visibleIdsKey.split(",")
    const syncOne = async (id: string) => {
      try {
        const res = await fetch(`/api/requests/${id}/sync`, { cache: "no-store" })
        if (!res.ok) return
        const json = await res.json().catch(() => null) as { request?: Record<string, unknown>; sync?: Record<string, unknown> } | null
        const request = json?.request
        if (request) await patchRequestCache(id, request)
      } catch {
        /* ignore */
      }
    }
    void Promise.allSettled(ids.map(syncOne)).then(() => {
      mutateList()
    })
  }, [visibleIdsKey, mutateList, visibleSyncTick])

  const showEmpty = !isInitialLoading && filteredRequests.length === 0
  const isLoading = isInitialLoading
  return (
    <div className="space-y-4">
      <Card className="pt-0">
        <div className="rounded-t-xl py-6 flex flex-wrap items-center justify-between gap-4 px-6">
          <div>
            <h2 className="text-xl font-semibold leading-none">Requests</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Track infrastructure requests and their latest status
            </p>
          </div>
          <Button asChild size="lg" className="cursor-pointer shrink-0">
            <Link href="/requests/new">New Request</Link>
          </Button>
        </div>
        <div className="px-6 pt-2 pb-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 mt-4 min-h-11 rounded-lg py-3">
            <div className="relative h-11 flex items-center">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder=""
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-11 w-72 shrink-0 pl-9 pr-3 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div
              role="tablist"
              aria-label="Dataset mode"
              className="inline-flex h-11 items-stretch rounded-lg bg-muted/50 dark:bg-muted/40 p-1 gap-0"
            >
              {(["active", "drifted", "destroyed", "all"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={datasetMode === mode}
                  className={cn(
                    "relative flex h-full items-center rounded-md px-3 py-0 text-sm font-medium transition-colors cursor-pointer",
                    datasetMode === mode
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setDatasetMode(mode)}
                >
                  {mode === "active" ? "Active" : mode === "drifted" ? "Drifted" : mode === "destroyed" ? "Destroyed" : "All"}
                </button>
              ))}
            </div>
            <Select value={envFilter} onValueChange={(val) => setEnvFilter(val as typeof envFilter)}>
              <SelectTrigger
                className="!h-11 min-w-[130px] rounded-md bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                <SelectValue placeholder="All envs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All envs</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="prod">Prod</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={(val) => setModuleFilter(val)}>
              <SelectTrigger
                className="!h-11 min-w-[130px] rounded-md bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {moduleOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={(val) => setProjectFilter(val)}>
              <SelectTrigger
                className="!h-11 min-w-[130px] rounded-md bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              className="h-11 px-4 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchTerm("")
                setDatasetMode("active")
                setEnvFilter("all")
                setModuleFilter("all")
                setProjectFilter("all")
              }}
            >
              Clear filters
            </Button>
          </div>
          <TooltipProvider delayDuration={200}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeadSortable sortDirection={sortDir("id")} onSort={() => handleSort("id")}>
                  Request ID
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("project")} onSort={() => handleSort("project")}>
                  Project
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("module")} onSort={() => handleSort("module")}>
                  Module
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("service")} onSort={() => handleSort("service")}>
                  Resource Name
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("environment")} onSort={() => handleSort("environment")}>
                  Environment
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("status")} onSort={() => handleSort("status")}>
                  Status
                </TableHeadSortable>
                <TableHeadSortable sortDirection={sortDir("createdAt")} onSort={() => handleSort("createdAt")} iconVariant="dual">
                  Created
                </TableHeadSortable>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading &&
                Array.from({ length: 5 }).map((_, idx) => (
                  <SkeletonRow key={idx} />
                ))}

              {showEmpty && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center">
                    <div className="text-sm text-muted-foreground">
                      No requests yet. Start by creating a new request.
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!isLoading &&
                filteredRequests.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/requests/${item.id}`}
                        className="cursor-pointer text-primary no-underline"
                      >
                        {item.id}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{item.project}</TableCell>
                    <TableCell className="capitalize">
                      {item.module ?? "N/A"}
                    </TableCell>
                    <TableCell className="capitalize">
                      {item.service ?? "N/A"}
                    </TableCell>
                    <TableCell className="capitalize">
                      {item.environment}
                    </TableCell>
                    <TableCell className="text-sm text-foreground whitespace-normal break-words leading-tight align-middle">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusIndicator
                          variant="pill"
                          status={normalizeRequestStatus(item.status, {
                            isDestroyed: item.status === "destroyed",
                            isDestroying: item.status === "destroying",
                          })}
                        />
                        {item.drift?.status === "detected" && (
                          <Badge variant="destructive" className="text-xs">
                            Drift
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-normal break-words leading-tight text-xs tabular-nums">
                      {formatTimestamp(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-right align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" asChild className="cursor-pointer size-10 min-w-10 min-h-10" aria-label="View request">
                            <Link href={`/requests/${item.id}`}>
                              <Eye className="h-4 w-4 text-primary" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
<TooltipContent side="top" align="center" sideOffset={2}>
                            View request
                          </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          </TooltipProvider>
        </div>
      </Card>
    </div>
  )
}