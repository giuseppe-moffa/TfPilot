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

type AuditEvent = {
  id: string
  org_id: string
  actor_login: string | null
  source: string
  event_type: string
  entity_type: string
  entity_id: string
  created_at: string
  metadata: Record<string, unknown> | null
  request_id: string | null
  workspace_id: string | null
  project_key: string | null
}

type AuditResponse = {
  events: AuditEvent[]
  next_cursor: string | null
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  org_created: "Org created",
  org_archived: "Org archived",
  org_restored: "Org restored",
  team_created: "Team created",
  team_member_added: "Team member added",
  team_member_removed: "Team member removed",
  project_access_granted: "Project access granted",
  project_access_revoked: "Project access revoked",
  request_created: "Request created",
  request_approved: "Request approved",
  request_apply_dispatched: "Request apply dispatched",
  request_destroy_dispatched: "Request destroy dispatched",
  workspace_destroy_requested: "Workspace destroy requested",
  workspace_deploy_pr_opened: "Workspace deploy PR opened",
}

function formatEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  return `${date} · ${time}`
}

function formatActor(evt: AuditEvent): string {
  if (evt.actor_login) return evt.actor_login
  if (evt.source === "github_webhook") return "GitHub webhook"
  if (evt.source === "system") return "System"
  return evt.source
}

function formatEntityLabel(evt: AuditEvent): string {
  if (evt.entity_type === "request" && evt.request_id) {
    return evt.request_id.slice(0, 12)
  }
  if (evt.entity_type === "org" && evt.metadata?.slug) {
    return evt.metadata.slug as string
  }
  if (evt.entity_type === "team" && evt.metadata?.team_slug) {
    return evt.metadata.team_slug as string
  }
  return evt.entity_id.slice(0, 12)
}

function AuditSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-48 animate-pulse bg-muted" />
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

export default function AuditPage() {
  const [events, setEvents] = React.useState<AuditEvent[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadMoreLoading, setLoadMoreLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)

  const loadInitial = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    fetch("/api/audit?limit=25", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          if (res.status === 403) setForbidden(true)
          else if (res.status === 503) setError("Service temporarily unavailable")
          return { data: null, forbidden: res.status === 403, serviceError: res.status === 503 }
        }
        if (!res.ok) return { data: null }
        const data = (await res.json()) as AuditResponse
        return { data }
      })
      .then((result) => {
        if (result.forbidden || result.serviceError) return
        if (result.data) {
          setEvents(result.data.events ?? [])
          setNextCursor(result.data.next_cursor ?? null)
        } else {
          setError("Failed to load audit events")
        }
      })
      .catch(() => setError("Failed to load audit events"))
      .finally(() => setLoading(false))
  }, [])

  const loadMore = React.useCallback(() => {
    if (!nextCursor) return
    setLoadMoreLoading(true)
    fetch(`/api/audit?limit=25&cursor=${encodeURIComponent(nextCursor)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuditResponse | null) => {
        if (data?.events?.length) {
          setEvents((prev) => [...prev, ...data.events])
          setNextCursor(data.next_cursor ?? null)
        } else if (data) {
          setNextCursor(null)
        }
      })
      .finally(() => setLoadMoreLoading(false))
  }, [nextCursor])

  React.useEffect(() => {
    loadInitial()
  }, [loadInitial])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Audit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform activity for your organization.
          </p>
        </div>
        <AuditSkeleton />
      </div>
    )
  }

  if (forbidden || error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Audit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform activity for your organization.
          </p>
        </div>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            {error ?? "You don't have permission to view audit events."}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Audit</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform activity for your organization.
        </p>
      </div>

      <Card className="p-6">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit activity yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-muted-foreground">ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatTimestamp(evt.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{formatActor(evt)}</TableCell>
                    <TableCell>{formatEventType(evt.event_type)}</TableCell>
                    <TableCell>
                      {evt.entity_type === "request" && evt.request_id ? (
                        <Link
                          href={`/requests/${evt.request_id}`}
                          className="text-primary hover:underline"
                        >
                          {formatEntityLabel(evt)}
                        </Link>
                      ) : (
                        formatEntityLabel(evt)
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {evt.entity_id.slice(0, 16)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {nextCursor && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadMoreLoading}
                  onClick={loadMore}
                >
                  {loadMoreLoading ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
