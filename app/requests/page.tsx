"use client"

import * as React from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"
import { useAwsConnection } from "../providers"
import type { RequestStatus } from "@/lib/requests/status"

type RequestRow = {
  id: string
  project: string
  environment: string
  service?: string
  status?: RequestStatus | "pending" | "applied" | "planned"
  pullRequest?: { status?: string }
  updatedAt?: string
  config?: Record<string, unknown>
}

type DisplayStatus = "submitted" | "planned" | "approved" | "merged" | "applied"

function computeStatus(row: RequestRow): {
  step: DisplayStatus
  subtitle: string
  state: "completed" | "pending"
} {
  const status = row.status ?? "pending"
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

function formatUpdatedAt(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

function SkeletonRow() {
  return (
    <TableRow>
      {[...Array(7)].map((_, idx) => (
        <TableCell key={idx}>
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  )
}

export default function RequestsPage() {
  const [isLoading, setIsLoading] = React.useState(true)
  const [requests, setRequests] = React.useState<RequestRow[]>([])
  const { isConnected } = useAwsConnection()

  React.useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch("/api/requests")
        if (!res.ok) throw new Error("Failed to fetch requests")
        const data = (await res.json()) as {
          success: boolean
          requests?: Array<{
            id: string
            project: string
            environment: string
            module?: string
            config?: Record<string, unknown>
            receivedAt?: string
            updatedAt?: string
            status?: RequestRow["status"]
            pullRequest?: { status?: string }
          }>
        }
        if (!active) return
        const rows =
          data.requests?.map((r) => ({
            id: r.id,
            project: r.project,
            environment: r.environment,
            service:
              typeof r.config?.["name"] === "string"
                ? (r.config["name"] as string)
                : undefined,
            status: r.status ?? ("pending" as const),
            updatedAt: r.receivedAt ?? r.updatedAt,
            config: r.config,
            pullRequest: r.pullRequest,
          })) ?? []
        rows.forEach((row) =>
          console.log("[requests] row", row.id, { configName: row.service })
        )
        setRequests(rows)
      } catch (error) {
        console.error("[requests] fetch error", error)
        if (active) setRequests([])
      } finally {
        if (active) setIsLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const showEmpty = !isLoading && requests.length === 0
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request ID</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
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
                  <TableCell colSpan={7} className="py-8 text-center">
                    <div className="text-sm text-muted-foreground">
                      No requests yet. Start by creating a new request.
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!isLoading &&
                requests.map((item) => (
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
                      {item.service ?? "N/A"}
                    </TableCell>
                    <TableCell className="capitalize">
                      {item.environment}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {computeStatus(item).subtitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatUpdatedAt(item.updatedAt)}
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