"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
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

type OrgDetailResponse = {
  org: { id: string; slug: string; name: string; createdAt: string; archivedAt: string | null }
  stats: { memberCount: number; teamCount: number; projectCount: number }
  members: { login: string; role: string; joinedAt: string }[]
  teams: { id: string; slug: string; name: string; membersCount: number }[]
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

async function fetchOrgDetail(orgId: string): Promise<{
  data?: OrgDetailResponse
  forbidden?: boolean
  notFound?: boolean
  error?: boolean
}> {
  const res = await fetch(`/api/platform/orgs/${encodeURIComponent(orgId)}`, {
    credentials: "include",
  })
  if (res.status === 404) return { notFound: true }
  if (res.status === 401 || res.status === 403) return { forbidden: true }
  if (!res.ok) return { error: true }
  const data = (await res.json()) as OrgDetailResponse
  return { data }
}

export default function PlatformOrgDetailClient({ orgId }: { orgId: string }) {
  const [data, setData] = React.useState<OrgDetailResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [archiving, setArchiving] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)

  const load = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    setNotFound(false)
    fetchOrgDetail(orgId)
      .then((result) => {
        if (result.notFound) setNotFound(true)
        else if (result.forbidden) setForbidden(true)
        else if (result.error) setError("Failed to load org")
        else if (result.data) setData(result.data)
      })
      .catch(() => setError("Failed to load org"))
      .finally(() => setLoading(false))
  }, [orgId])

  React.useEffect(() => {
    load()
  }, [load])

  const handleArchive = async () => {
    if (!orgId || archiving || restoring) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/platform/orgs/${encodeURIComponent(orgId)}/archive`, {
        method: "POST",
        credentials: "include",
      })
      if (!res.ok) return
      load()
    } finally {
      setArchiving(false)
    }
  }

  const handleRestore = async () => {
    if (!orgId || archiving || restoring) return
    setRestoring(true)
    try {
      const res = await fetch(`/api/platform/orgs/${encodeURIComponent(orgId)}/restore`, {
        method: "POST",
        credentials: "include",
      })
      if (!res.ok) return
      load()
    } finally {
      setRestoring(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">Loading org…</p>
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (notFound) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Org not found.</p>
      </Card>
    )
  }

  if (forbidden || error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          {error ?? "You don't have permission to view this org."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  const { org, stats, members, teams } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/platform/orgs"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Platform Orgs
        </Link>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Platform Org</h2>
        {org.archivedAt ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Archived</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={restoring}
              onClick={handleRestore}
            >
              {restoring ? "Restoring…" : "Restore"}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={archiving}
            onClick={handleArchive}
          >
            {archiving ? "Archiving…" : "Archive"}
          </Button>
        )}
      </div>

      {/* Section 1 – Org summary card */}
      <Card className="p-6">
        <h3 className="mb-4 text-sm font-medium">Org summary</h3>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{org.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-medium">{org.slug}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono text-xs">{org.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatTimestamp(org.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {/* Section 2 – Stats */}
      <Card className="p-6">
        <h3 className="mb-4 text-sm font-medium">Stats</h3>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Members</dt>
            <dd className="text-lg font-medium">{stats.memberCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Teams</dt>
            <dd className="text-lg font-medium">{stats.teamCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Projects</dt>
            <dd className="text-lg font-medium">{stats.projectCount}</dd>
          </div>
        </dl>
      </Card>

      {/* Section 3 – Members table */}
      <Card className="p-6">
        <h3 className="mb-4 text-sm font-medium">Members</h3>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GitHub login</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.login}>
                  <TableCell className="font-medium">{m.login}</TableCell>
                  <TableCell>{m.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(m.joinedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Section 4 – Teams table */}
      <Card className="p-6">
        <h3 className="mb-4 text-sm font-medium">Teams</h3>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.slug}</TableCell>
                  <TableCell>{t.membersCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
