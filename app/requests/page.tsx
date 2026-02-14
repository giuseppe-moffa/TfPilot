"use client"

import * as React from "react"
import useSWR from "swr"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import { useAwsConnection } from "../providers"
import type { RequestStatus } from "@/lib/requests/status"

type RequestRow = {
  id: string
  project: string
  environment: string
  service?: string
  module?: string
  status?: RequestStatus | "pending" | "applied" | "planned" | "destroying" | "destroyed"
  pullRequest?: { status?: string }
  createdAt?: string
  config?: Record<string, unknown>
}

type DisplayStatus = "submitted" | "planned" | "approved" | "merged" | "applied" | "destroyed"

function computeStatus(row: RequestRow): {
  step: DisplayStatus
  subtitle: string
  state: "completed" | "pending"
} {
  const status = row.status ?? "pending"
  if (status === "destroyed") {
    return { step: "destroyed", subtitle: "Destroyed", state: "completed" }
  }
  if (status === "destroying") {
    return { step: "destroyed", subtitle: "Destroying", state: "pending" }
  }
  const isApplied = status === "applied" || status === "complete"
  const isMerged =
    status === "merged" || status === "applying" || isApplied || row.pullRequest?.status === "merged"
  const isApproved = status === "approved" || status === "awaiting_approval" || isMerged
  const isPlanReady = status === "planned" || status === "plan_ready" || isApproved || isMerged || isApplied

  if (isApplied) {
    return { step: "applied", subtitle: "Deployment Completed", state: "completed" }
  }
  if (isMerged) {
    return { step: "merged", subtitle: "Pull request merged", state: "completed" }
  }
  if (isApproved) {
    return { step: "approved", subtitle: "Approved, awaiting merge", state: "completed" }
  }
  if (isPlanReady) {
    return { step: "planned", subtitle: "Plan ready", state: "completed" }
  }
  return { step: "submitted", subtitle: "Request created", state: "pending" }
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

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
    refreshInterval: 8000,
  })
  const { data, error } = swr
  const isValidating = (swr as any).isValidating ?? false

  const [requests, setRequests] = React.useState<RequestRow[]>([])
  const [statusFilter, setStatusFilter] = React.useState<"active" | "destroyed" | "all">("active")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [envFilter, setEnvFilter] = React.useState<"all" | "dev" | "prod">("all")
  const [moduleFilter, setModuleFilter] = React.useState<string>("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")
  const { isConnected } = useAwsConnection()

  React.useEffect(() => {
    const rows =
      data?.requests?.map((r: any) => ({
        id: r.id,
        project: r.project,
        environment: r.environment,
        module: r.module,
        service:
          typeof r.config?.["name"] === "string" ? (r.config["name"] as string) : undefined,
        status: r.status ?? ("pending" as const),
        createdAt: r.receivedAt,
        config: r.config,
        pullRequest: r.pullRequest,
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

  const isLoading = (!data && !error) || isValidating

  const filteredRequests = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return requests.filter((row) => {
      const status = row.status
      const isDestroyed = status === "destroyed" || status === "destroying"
      if (statusFilter === "destroyed" && !isDestroyed) return false
      if (statusFilter === "active" && isDestroyed) return false

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
  }, [requests, statusFilter, envFilter, moduleFilter, projectFilter, searchTerm])

  const showEmpty = !isLoading && filteredRequests.length === 0
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold">Requests</CardTitle>
          <CardDescription>
            Track infrastructure requests and their latest plan status.
          </CardDescription>
          <CardAction>
            <Button asChild className="cursor-pointer">
              <Link href="/requests/new">New Request</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search requests"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-72 px-3 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {(["active", "destroyed", "all"] as const).map((value) => (
              <Button
                key={value}
                variant={statusFilter === value ? "default" : "outline"}
                className="h-9 px-4 cursor-pointer"
                onClick={() => setStatusFilter(value)}
              >
                {value === "active" ? "Active" : value === "destroyed" ? "Destroyed" : "All"}
              </Button>
            ))}
            <Select value={envFilter} onValueChange={(val) => setEnvFilter(val as typeof envFilter)}>
              <SelectTrigger className="h-9 min-w-[130px] rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0">
                <SelectValue placeholder="All envs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All envs</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="prod">Prod</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={(val) => setModuleFilter(val)}>
              <SelectTrigger className="h-9 min-w-[130px] rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0">
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
              <SelectTrigger className="h-9 min-w-[130px] rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0">
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
              variant="secondary"
              className="h-9 px-4 cursor-pointer"
              onClick={() => {
                setSearchTerm("")
                setStatusFilter("active")
                setEnvFilter("all")
                setModuleFilter("all")
                setProjectFilter("all")
              }}
            >
              Clear filters
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request ID</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Resource Name</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
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
                    <TableCell className="text-sm text-foreground whitespace-normal break-words leading-tight">
                      {computeStatus(item).subtitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-normal break-words leading-tight">
                      {formatTimestamp(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="secondary" asChild className="cursor-pointer">
                        <Link href={`/requests/${item.id}`}>View Request</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}