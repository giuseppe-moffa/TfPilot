"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Eye, FileSearch, Plus } from "lucide-react"
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

type Workspace = {
  workspace_id: string
  project_key: string
  repo_full_name: string
  workspace_key: string
  workspace_slug: string
  archived_at: string | null
  created_at: string
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
}

function SkeletonRow() {
  return (
    <TableRow>
      {[...Array(5)].map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full animate-pulse bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  )
}

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params?.projectId as string | undefined

  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = React.useState(false)

  React.useEffect(() => {
    if (!projectId) return
    setLoading(true)
    const params = new URLSearchParams({ project_key: projectId })
    if (includeArchived) params.set("include_archived", "true")
    fetch(`/api/workspaces?${params}`)
      .then((res) => (res.ok ? res.json() : { workspaces: [] }))
      .then((data: { workspaces?: Workspace[] }) => {
        setWorkspaces(data?.workspaces ?? [])
        setError(null)
      })
      .catch(() => {
        setWorkspaces([])
        setError("Failed to load workspaces")
      })
      .finally(() => setLoading(false))
  }, [projectId, includeArchived])

  const showEmpty = !loading && workspaces.length === 0

  return (
    <>
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <h3 className="text-base font-semibold">Workspaces</h3>
            <p className="text-xs text-muted-foreground">
              Terraform roots and their deploy status
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIncludeArchived((v) => !v)}
            >
              {includeArchived ? "Hide archived" : "Show archived"}
            </button>
            <Button asChild size="lg">
              <Link href={`/projects/${projectId}/workspaces/new`}>
                <Plus className="h-4 w-4 mr-1" />
                New Workspace
              </Link>
            </Button>
          </div>
        </div>

        <div className="px-6 pb-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Environment</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}

              {showEmpty && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <FileSearch
                        className="h-12 w-12 text-muted-foreground/60"
                        strokeWidth={1.25}
                      />
                      <p className="text-sm text-muted-foreground">
                        No workspaces yet.{" "}
                        <Link
                          href={`/projects/${projectId}/workspaces/new`}
                          className="text-primary hover:underline"
                        >
                          Create the first workspace.
                        </Link>
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                workspaces.map((ws) => (
                  <TableRow key={ws.workspace_id}>
                    <TableCell className="font-medium font-mono text-sm">
                      {ws.workspace_key}
                    </TableCell>
                    <TableCell>{ws.workspace_slug}</TableCell>
                    <TableCell>
                      {ws.archived_at ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                      {formatTimestamp(ws.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" asChild className="size-9">
                        <Link
                          href={`/projects/${projectId}/workspaces/${ws.workspace_id}`}
                          aria-label="View workspace"
                        >
                          <Eye className="h-4 w-4 text-primary" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  )
}
