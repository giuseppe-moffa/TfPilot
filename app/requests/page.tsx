"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
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
import { ChevronLeft, ChevronRight, Eye, FileSearch, Search } from "lucide-react"

import { ModuleTag } from "@/components/icons/module-icon"
import { cn } from "@/lib/utils"
import { useAwsConnection } from "../providers"
import { patchRequestCache } from "@/hooks/use-request"
import { normalizeRequestStatus } from "@/lib/status/status-config"
import { formatWorkspaceDisplay } from "@/lib/format/workspaceDisplay"

type RequestRow = {
  id: string
  project: string
  project_key?: string
  workspace: string
  workspace_key?: string
  name?: string
  module?: string
  status?: string
  pullRequest?: { status?: string }
  createdAt?: string
  updatedAt?: string
  config?: Record<string, unknown>
  drift?: {
    status?: "none" | "detected"
    lastCheckedAt?: string
    runId?: number
    runUrl?: string
    summary?: string
  }
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
/** Requests shown per page in the table. */
const PAGE_SIZE = 10

function SkeletonRow() {
  return (
    <TableRow>
      {[...Array(9)].map((_, idx) => (
        <TableCell key={idx}>
          <div className="h-4 w-full animate-pulse bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  )
}

function mapApiRequestToRow(r: {
  id?: string
  project?: string
  project_key?: string
  workspace_key?: string
  workspace_slug?: string
  module?: string
  config?: Record<string, unknown>
  status?: string
  receivedAt?: string
  updatedAt?: string
  index_projection_updated_at?: string
  index_projection_last_activity_at?: string
  pullRequest?: { status?: string }
  drift?: RequestRow["drift"]
}): RequestRow {
  return {
    id: r.id ?? "",
    project: r.project_key ?? r.project ?? "",
    project_key: r.project_key ?? r.project ?? "",
    workspace: formatWorkspaceDisplay(r.workspace_key ?? "", r.workspace_slug ?? ""),
    workspace_key: r.workspace_key ?? "",
    module: r.module,
    name:
      typeof r.config?.["name"] === "string" ? (r.config["name"] as string) : undefined,
    status: r.status ?? "pending",
    createdAt: r.receivedAt,
    updatedAt: r.index_projection_last_activity_at ?? r.index_projection_updated_at ?? r.updatedAt,
    config: r.config,
    pullRequest: r.pullRequest,
    drift: r.drift,
  }
}

/** In-place patch: update only status, drift, pullRequest on matching rows. No reorder. */
function applyPatchesToPages(
  pages: RequestRow[][],
  patches: Array<Pick<RequestRow, "id" | "status" | "drift" | "pullRequest">>
): RequestRow[][] {
  if (patches.length === 0) return pages
  const patchMap = new Map(patches.map((p) => [p.id, p]))
  return pages.map((page) =>
    page.map((row) => {
      const patch = patchMap.get(row.id)
      if (!patch) return row
      return {
        ...row,
        status: patch.status ?? row.status,
        drift: patch.drift ?? row.drift,
        pullRequest: patch.pullRequest ?? row.pullRequest,
      }
    })
  )
}

export default function RequestsPage() {
  const [pages, setPages] = React.useState<RequestRow[][]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [listErrors, setListErrors] = React.useState<Array<{ request_id: string; error: string }>>([])
  const [initialLoading, setInitialLoading] = React.useState(true)

  type DatasetMode = "active" | "drifted" | "destroyed" | "all"
  const [datasetMode, setDatasetMode] = React.useState<DatasetMode>("active")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [envFilter, setEnvFilter] = React.useState<"all" | "dev" | "prod">("all")
  const [moduleFilter, setModuleFilter] = React.useState<string>("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")
  const { isConnected } = useAwsConnection()

  const requests = React.useMemo(() => pages.flat(), [pages])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/requests?limit=${PAGE_SIZE}`, { cache: "no-store" })
      const data = await res.json()
      if (cancelled) return
      if (!data?.success || !Array.isArray(data.requests)) {
        setInitialLoading(false)
        return
      }
      const mapped = data.requests.map((r: unknown) =>
        mapApiRequestToRow(r as Parameters<typeof mapApiRequestToRow>[0])
      )
      setPages([mapped])
      setNextCursor(data.next_cursor ?? null)
      setListErrors(data.list_errors ?? [])
      setInitialLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = React.useCallback(
    async (onLoaded?: () => void) => {
      if (!nextCursor || loadingMore) return
      setLoadingMore(true)
      try {
        const res = await fetch(
          `/api/requests?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
          { cache: "no-store" }
        )
        const data = await res.json()
        if (!data?.success || !Array.isArray(data.requests)) return
        const mapped = data.requests.map((r: unknown) =>
          mapApiRequestToRow(r as Parameters<typeof mapApiRequestToRow>[0])
        )
        setPages((prev) => [...prev, mapped])
        setNextCursor(data.next_cursor ?? null)
        setListErrors((prev) => [...prev, ...(data.list_errors ?? [])])
        onLoaded?.()
      } finally {
      setLoadingMore(false)
    }
  },
    [nextCursor, loadingMore]
  )

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

  const filteredRequests = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const filtered = requests.filter((row) => {
      const status = row.status
      const isFullyDestroyed = status === "destroyed"
      const isInDestroyedTab = status === "destroyed" || status === "destroying"
      if (datasetMode === "destroyed" && !isInDestroyedTab) return false
      if (datasetMode === "active" && isFullyDestroyed) return false
      if (datasetMode === "drifted" && row.drift?.status !== "detected") return false

      if (envFilter !== "all" && (row.workspace_key ?? "").toLowerCase() !== envFilter) return false
      if (moduleFilter !== "all" && row.module !== moduleFilter) return false
      if (projectFilter !== "all" && row.project !== projectFilter) return false

      if (!term) return true
      const haystack = [
        row.id,
        row.project ?? row.project_key,
        row.workspace,
        row.module,
        row.name,
        row.config && typeof row.config === "object" ? JSON.stringify(row.config) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
    return filtered
  }, [requests, datasetMode, envFilter, moduleFilter, projectFilter, searchTerm])

  const totalFiltered = filteredRequests.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const displayedRequests = React.useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredRequests.slice(start, start + PAGE_SIZE)
  }, [filteredRequests, currentPage])

  const handleNextPage = React.useCallback(async () => {
    if (currentPage < totalPages) {
      setCurrentPage((p) => p + 1)
    } else if (nextCursor && !loadingMore) {
      await loadMore(() => setCurrentPage((p) => p + 1))
    }
  }, [currentPage, totalPages, nextCursor, loadingMore, loadMore])

  const handlePrevPage = React.useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1))
  }, [])

  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) setCurrentPage(1)
  }, [currentPage, totalPages])

  const visibleIdsKey = React.useMemo(
    () => displayedRequests.map((r) => r.id).join(","),
    [displayedRequests]
  )
  const lastVisibleSyncRef = React.useRef<{ key: string; at: number }>({ key: "", at: 0 })
  const [visibleSyncTick, setVisibleSyncTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setVisibleSyncTick((t) => t + 1), VISIBLE_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  React.useEffect(() => {
    if (!visibleIdsKey) return
    if (visibleSyncTick < 1) return
    const now = Date.now()
    if (
      lastVisibleSyncRef.current.key === visibleIdsKey &&
      now - lastVisibleSyncRef.current.at < VISIBLE_SYNC_DEBOUNCE_MS
    )
      return
    lastVisibleSyncRef.current = { key: visibleIdsKey, at: now }
    const ids = visibleIdsKey.split(",")

    const syncOne = async (
      id: string
    ): Promise<Pick<RequestRow, "id" | "status" | "drift" | "pullRequest"> | null> => {
      try {
        const res = await fetch(`/api/requests/${id}/sync`, { cache: "no-store" })
        if (!res.ok) return null
        const json = (await res.json().catch(() => null)) as
          | { request?: Record<string, unknown>; sync?: Record<string, unknown> }
          | null
        const request = json?.request
        if (!request) return null
        await patchRequestCache(id, request)
        const row = mapApiRequestToRow(request as Parameters<typeof mapApiRequestToRow>[0])
        return { id: row.id, status: row.status, drift: row.drift, pullRequest: row.pullRequest }
      } catch {
        return null
      }
    }

    void Promise.allSettled(ids.map(syncOne)).then((results) => {
      const patches: Array<Pick<RequestRow, "id" | "status" | "drift" | "pullRequest">> = []
      for (const r of results) {
        if (r.status === "fulfilled" && r.value != null) patches.push(r.value)
      }
      if (patches.length === 0) return
      setPages((prev) => applyPatchesToPages(prev, patches))
    })
  }, [visibleIdsKey, visibleSyncTick])

  const showEmpty = !initialLoading && filteredRequests.length === 0
  const isLoading = initialLoading

  const emptyMessage =
    requests.length === 0
      ? "No requests yet. Start by creating a new request."
      : (() => {
          if (datasetMode === "drifted") return "No drifted requests."
          if (datasetMode === "destroyed") return "No destroyed requests."
          if (datasetMode === "active") return "No active requests."
          return "No requests match your filters."
        })()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Resource overview</h3>
            <p className="text-xs text-muted-foreground">Resource requests and their lifecycle status</p>
          </div>
          <Button asChild size="lg" className="cursor-pointer shrink-0">
            <Link href="/requests/new">New Request</Link>
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
          {listErrors.length > 0 && (
            <div className="mb-4 border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Some indexed requests are missing in S3. Run index rebuild/prune.
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-3 mt-4 min-h-11 py-3">
            <div className="relative h-11 flex items-center">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, module, project…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-11 w-72 shrink-0 pl-9 pr-3 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div
              role="tablist"
              aria-label="Dataset mode"
              className="inline-flex h-11 items-stretch bg-muted/50 dark:bg-muted/40 p-1 gap-0"
            >
              {(["active", "drifted", "destroyed", "all"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={datasetMode === mode}
                  className={cn(
                    "relative flex h-full items-center px-3 py-0 text-sm font-medium transition-colors cursor-pointer",
                    datasetMode === mode
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setDatasetMode(mode)}
                >
                  {mode === "active"
                    ? "Active"
                    : mode === "drifted"
                      ? "Drifted"
                      : mode === "destroyed"
                        ? "Destroyed"
                        : "All"}
                </button>
              ))}
            </div>
            <Select value={envFilter} onValueChange={(val) => setEnvFilter(val as typeof envFilter)}>
              <SelectTrigger
                className="!h-11 min-w-[130px] bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                <SelectValue placeholder="All workspaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="prod">Prod</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={(val) => setModuleFilter(val)}>
              <SelectTrigger
                className="!h-11 min-w-[130px] bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
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
                className="!h-11 min-w-[130px] bg-muted/50 dark:bg-muted/40 px-3 text-sm text-foreground shadow-none hover:bg-muted/60 dark:hover:bg-muted/50 data-[state=open]:bg-muted/60 dark:data-[state=open]:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0"
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
                  <TableHead>Request ID</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Resource Name</TableHead>
                  <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialLoading &&
                  Array.from({ length: 5 }).map((_, idx) => <SkeletonRow key={idx} />)}

                {showEmpty && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <FileSearch className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.25} />
                        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading &&
                  displayedRequests.map((item) => (
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
                      <TableCell>
                        <div className="flex items-center gap-1 capitalize">
                          <ModuleTag module={item.module ?? ""} />
                        </div>
                      </TableCell>
                      <TableCell>{item.name ?? "N/A"}</TableCell>
                      <TableCell className="capitalize">{item.workspace}</TableCell>
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
                      <TableCell className="text-muted-foreground whitespace-normal break-words leading-tight text-xs tabular-nums">
                        {formatTimestamp(item.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              asChild
                              className="cursor-pointer size-10 min-w-10 min-h-10"
                              aria-label="View request"
                            >
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

          {!initialLoading && totalFiltered > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-4">
              <p className="text-sm text-muted-foreground order-2 sm:order-1">
                Showing {(currentPage - 1) * PAGE_SIZE + 1} to{" "}
                {Math.min(currentPage * PAGE_SIZE, totalFiltered)} of {totalFiltered} entries
              </p>
              <div className="flex items-center gap-1 order-1 sm:order-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 cursor-pointer"
                  onClick={handlePrevPage}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    className="h-8 min-w-8 px-2.5 cursor-pointer"
                    onClick={() => setCurrentPage(page)}
                    aria-label={`Page ${page}`}
                    aria-current={currentPage === page ? "page" : undefined}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 cursor-pointer"
                  onClick={handleNextPage}
                  disabled={
                    currentPage >= totalPages && (!nextCursor || loadingMore)
                  }
                  aria-label="Next page"
                >
                  {loadingMore && currentPage >= totalPages ? (
                    <span className="h-4 w-4 animate-spin">⋯</span>
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
