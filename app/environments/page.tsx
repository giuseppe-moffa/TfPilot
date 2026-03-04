"use client"

import * as React from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Eye, FileSearch, Search } from "lucide-react"
import { cn } from "@/lib/utils"
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

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  return `${date} · ${time}`
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

type DatasetMode = "active" | "archived" | "all"

export default function EnvironmentsPage() {
  const [datasetMode, setDatasetMode] = React.useState<DatasetMode>("active")
  const [envs, setEnvs] = React.useState<Environment[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [envFilter, setEnvFilter] = React.useState<"all" | "dev" | "prod">("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")

  const projects = listProjects()

  const includeArchived = datasetMode === "archived" || datasetMode === "all"

  React.useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (projectFilter && projectFilter !== "all") params.set("project_key", projectFilter)
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
  }, [projectFilter, includeArchived])

  const filteredEnvs = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return envs.filter((e) => {
      if (datasetMode === "active" && e.archived_at) return false
      if (datasetMode === "archived" && !e.archived_at) return false

      if (envFilter !== "all" && (e.environment_key ?? "").toLowerCase() !== envFilter) return false
      if (projectFilter !== "all" && e.project_key !== projectFilter) return false

      if (!term) return true
      const haystack = [
        e.environment_id,
        e.project_key,
        e.environment_key,
        e.environment_slug,
        e.repo_full_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [envs, datasetMode, envFilter, projectFilter, searchTerm])

  const projectOptions = React.useMemo(() => {
    if (projects.length > 0) return projects
    const set = new Set<string>()
    envs.forEach((e) => {
      if (e.project_key) set.add(e.project_key)
    })
    return Array.from(set)
  }, [envs, projects])

  const showEmpty = !loading && filteredEnvs.length === 0
  const emptyMessage =
    envs.length === 0
      ? "No environments yet. Start by creating a new environment."
      : datasetMode === "archived"
        ? "No archived environments."
        : datasetMode === "active"
          ? "No active environments."
          : "No environments match your filters."

  return (
    <div className="space-y-4">
      <Card className="pt-0">
        <div className="rounded-t-lg py-6 flex flex-wrap items-center justify-between gap-4 px-6">
          <div>
            <h2 className="text-xl font-semibold leading-none">Environments</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Model 2 environments. Create, list, and manage envs. Bootstrap PR creates envs/&lt;key&gt;/&lt;slug&gt;/ in the terraform repo.
            </p>
          </div>
          <Button asChild size="lg" className="cursor-pointer shrink-0">
            <Link href="/environments/new">New Environment</Link>
          </Button>
        </div>
        <div className="px-6 pt-2 pb-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 mt-4 min-h-11 rounded-lg py-3">
            <div className="relative h-11 flex items-center">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by project, key, name, repo…"
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
              {(["active", "archived", "all"] as const).map((mode) => (
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
                  {mode === "active"
                    ? "Active"
                    : mode === "archived"
                      ? "Archived"
                      : "All"}
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
            <Select
              value={projectFilter}
              onValueChange={(val) => setProjectFilter(val)}
            >
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
                setProjectFilter("all")
              }}
            >
              Clear filters
            </Button>
          </div>

          {error && (
            <p className="mb-4 text-sm text-destructive">{error}</p>
          )}

          <TooltipProvider delayDuration={200}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Repo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  Array.from({ length: 5 }).map((_, idx) => <SkeletonRow key={idx} />)}

                {showEmpty && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <FileSearch className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.25} />
                        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading &&
                  filteredEnvs.map((e) => (
                    <TableRow key={e.environment_id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/environments/${e.environment_id}`}
                          className="cursor-pointer text-primary no-underline"
                        >
                          {e.project_key}
                        </Link>
                      </TableCell>
                      <TableCell>{e.environment_key}</TableCell>
                      <TableCell>{e.environment_slug}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate" title={e.repo_full_name}>
                        {e.repo_full_name}
                      </TableCell>
                      <TableCell>
                        {e.archived_at ? (
                          <Badge variant="secondary">Archived</Badge>
                        ) : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                        {formatTimestamp(e.created_at)}
                      </TableCell>
                      <TableCell className="text-right align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              asChild
                              className="cursor-pointer size-10 min-w-10 min-h-10"
                              aria-label="View environment"
                            >
                              <Link href={`/environments/${e.environment_id}`}>
                                <Eye className="h-4 w-4 text-primary" />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="center" sideOffset={2}>
                            View environment
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
