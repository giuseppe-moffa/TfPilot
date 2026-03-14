"use client"

import * as React from "react"
import Link from "next/link"
import { FolderOpen, Plus } from "lucide-react"
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

type ProjectRow = {
  id: string
  project_key: string
  name: string
  workspace_count: number
}

function SkeletonRow() {
  return (
    <TableRow>
      {[...Array(3)].map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full animate-pulse bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  )
}

export default function ProjectsPage() {
  const [projects, setProjects] = React.useState<ProjectRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setLoading(true)
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: ProjectRow[] }) => {
        setProjects(data?.projects ?? [])
        setError(null)
      })
      .catch(() => {
        setProjects([])
        setError("Failed to load projects")
      })
      .finally(() => setLoading(false))
  }, [])

  const showEmpty = !loading && projects.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Projects</h3>
            <p className="text-xs text-muted-foreground">
              Infrastructure projects and their workspaces
            </p>
          </div>
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Link>
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}

              {showEmpty && (
                <TableRow>
                  <TableCell colSpan={3} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <FolderOpen
                        className="h-12 w-12 text-muted-foreground/60"
                        strokeWidth={1.25}
                      />
                      <p className="text-sm text-muted-foreground">
                        No projects yet. Create your first project to get started.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/projects/${p.project_key}`}
                        className="text-primary hover:underline"
                      >
                        {p.name || p.project_key}
                      </Link>
                      {p.name && p.name !== p.project_key && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p.project_key}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.workspace_count}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/projects/${p.project_key}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
