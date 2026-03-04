"use client"

import * as React from "react"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import { listProjects } from "@/config/infra-repos"

type Environment = {
  environment_id: string
  project_key: string
  repo_full_name: string
  environment_key: string
  environment_slug: string
  archived_at: string | null
  created_at: string
}

export default function EnvironmentsPage() {
  const [projectKey, setProjectKey] = React.useState<string>("")
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const [envs, setEnvs] = React.useState<Environment[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const projects = listProjects()

  React.useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (projectKey) params.set("project_key", projectKey)
    if (includeArchived) params.set("include_archived", "true")
    fetch(`/api/environments?${params}`)
      .then((res) => (res.ok ? res.json() : { environments: [] }))
      .then((data: { environments?: Environment[] }) => {
        setEnvs(data?.environments ?? [])
        setError(null)
      })
      .catch(() => {
        setEnvs([])
        setError("Failed to load environments")
      })
      .finally(() => setLoading(false))
  }, [projectKey, includeArchived])

  return (
    <div className="container max-w-4xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>Environments</CardTitle>
          <CardDescription>
            Model 2 environments. Create, list, and manage envs. Bootstrap PR creates envs/&lt;key&gt;/&lt;slug&gt;/ in the terraform repo.
          </CardDescription>
          <div className="flex flex-wrap gap-4 pt-2">
            <Select
              value={projectKey || "__all__"}
              onValueChange={(v) => setProjectKey(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Include archived
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-destructive">{error}</p>
          ) : envs.length === 0 ? (
            <p className="text-muted-foreground">No environments found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project / Key / Slug</TableHead>
                  <TableHead>Repo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envs.map((e) => (
                  <TableRow key={e.environment_id}>
                    <TableCell>
                      <span className="font-medium">{e.project_key}</span>
                      <span className="text-muted-foreground"> / </span>
                      {e.environment_key} / {e.environment_slug}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.repo_full_name}</TableCell>
                    <TableCell>
                      {e.archived_at ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/environments/${e.environment_id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
