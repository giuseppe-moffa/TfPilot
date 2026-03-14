"use client"

import * as React from "react"
import Link from "next/link"
import { Search, UsersRound, Trash2, Plus, FolderPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TeamMembersAvatars } from "@/components/teams/TeamMembersAvatars"
import { TeamProjectAssignments } from "@/components/teams/TeamProjectAssignments"
import { AssignTeamProjectDialog } from "@/components/teams/AssignTeamProjectDialog"

type TeamWithMembers = {
  id: string
  slug: string
  name: string
  description?: string | null
  createdAt: string
  membersCount: number
  members: { login: string }[]
}

type TeamsResponse = {
  teams: TeamWithMembers[]
}

type ProjectSummary = {
  id: string
  projectKey: string
  name: string
}

type ProjectsResponse = {
  projects: ProjectSummary[]
}

type Grant = { teamId: string; projectId: string; role?: string }

type AccessResponse = {
  grants: Grant[]
}

type OrgMember = {
  login: string
  display_name: string | null
  avatar_url: string | null
  role: string
  joinedAt: string
}

type OrgMembersResponse = {
  org: { id: string; slug: string; name: string }
  members: OrgMember[]
}

async function fetchTeams(): Promise<{
  data?: TeamsResponse
  forbidden?: boolean
  error?: boolean
}> {
  const res = await fetch("/api/org/teams", { credentials: "include" })
  if (res.status === 401 || res.status === 404 || res.status === 403) {
    return { forbidden: true }
  }
  if (!res.ok) return { error: true }
  const data = (await res.json()) as TeamsResponse
  return { data }
}

async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/org/projects", { credentials: "include" })
  if (!res.ok) return []
  const json = (await res.json()) as ProjectsResponse
  return json.projects ?? []
}

async function fetchAccess(): Promise<Grant[]> {
  const res = await fetch("/api/org/teams/access", { credentials: "include" })
  if (!res.ok) return []
  const json = (await res.json()) as AccessResponse
  return json.grants ?? []
}

async function fetchOrgMembers(): Promise<OrgMembersResponse | null> {
  const res = await fetch("/api/org/members", { credentials: "include" })
  if (!res.ok) return null
  return (await res.json()) as OrgMembersResponse
}

const PAGE_SIZE = 10

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "team"
}

export default function TeamsPage() {
  const [data, setData] = React.useState<TeamsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(
    null
  )
  const [searchQuery, setSearchQuery] = React.useState("")
  const [page, setPage] = React.useState(1)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createDescription, setCreateDescription] = React.useState("")
  const [createLoading, setCreateLoading] = React.useState(false)

  const [assignTeamId, setAssignTeamId] = React.useState<string | null>(null)
  const [assignTeamName, setAssignTeamName] = React.useState<string>("")
  const [removingProjectId, setRemovingProjectId] = React.useState<string | null>(null)

  const [orgMembers, setOrgMembers] = React.useState<OrgMember[]>([])
  const [projects, setProjects] = React.useState<ProjectSummary[]>([])
  const [grants, setGrants] = React.useState<Grant[]>([])

  const load = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    Promise.all([fetchTeams(), fetchProjects(), fetchAccess(), fetchOrgMembers()])
      .then(([teamsResult, projectsList, grantsList, membersResult]) => {
        if (teamsResult.forbidden) setForbidden(true)
        else if (teamsResult.error) setError("Failed to load teams")
        else if (teamsResult.data) setData(teamsResult.data)
        if (!teamsResult.forbidden) {
          setProjects(projectsList)
          setGrants(grantsList)
          setOrgMembers(membersResult?.members ?? [])
        }
      })
      .catch(() => setError("Failed to load teams"))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const filteredTeams = React.useMemo(() => {
    if (!data?.teams) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return data.teams
    return data.teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
    )
  }, [data?.teams, searchQuery])

  const paginatedTeams = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredTeams.slice(start, start + PAGE_SIZE)
  }, [filteredTeams, page])

  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / PAGE_SIZE))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createName.trim()) return
    setCreateLoading(true)
    setMessage(null)
    try {
      const name = createName.trim()
      const res = await fetch("/api/org/teams", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slugFromName(name),
          name,
          description: createDescription.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: "error", text: (json.error as string) ?? "Failed to create team" })
        return
      }
      setMessage({ type: "success", text: "Team created" })
      setCreateName("")
      setCreateDescription("")
      setCreateOpen(false)
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to create team" })
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDeleteTeam = async (teamId: string) => {
    setMessage(null)
    try {
      const res = await fetch(`/api/org/teams/${teamId}`, {
        method: "DELETE",
        credentials: "include",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({
          type: "error",
          text: (json.error as string) ?? "Failed to delete team",
        })
        return
      }
      setMessage({ type: "success", text: "Team deleted" })
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to delete team" })
    }
  }

  const membersWithAvatars = (team: TeamWithMembers) =>
    team.members.map((m) => {
      const om = orgMembers.find((o) => o.login === m.login)
      return {
        login: m.login,
        avatarUrl: om?.avatar_url ?? `https://github.com/${m.login}.png`,
      }
    })

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col p-6">
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
          <div className="mt-4 h-48 animate-pulse rounded-lg bg-muted" />
        </Card>
      </div>
    )
  }

  if (forbidden || error) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">
          {error ?? "You don't have permission to view teams."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Manage teams</h3>
            <p className="text-xs text-muted-foreground">
              Teams allow you to manage permissions for a group of users on a project, rather than
              individually
            </p>
          </div>
          <Button
            size="lg"
            className="cursor-pointer shrink-0 gap-2"
            onClick={() => {
              setCreateOpen(true)
              setCreateName("")
              setCreateDescription("")
            }}
          >
            <Plus className="h-4 w-4" />
            Add Team
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter teams by name"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
          </div>

          {message && (
            <p
              className={`mb-3 text-sm ${
                message.type === "success"
                  ? "text-green-600 dark:text-green-500"
                  : "text-destructive"
              }`}
            >
              {message.text}
            </p>
          )}

          {filteredTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams yet.</p>
          ) : (
            <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedTeams.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {t.description?.trim() || "No description"}
                    </TableCell>
                    <TableCell>
                      <TeamMembersAvatars members={membersWithAvatars(t)} />
                    </TableCell>
                    <TableCell>
                      <TeamProjectAssignments
                        teamId={t.id}
                        assignments={grants
                          .filter((g) => g.teamId === t.id)
                          .map((g) => ({
                            projectId: g.projectId,
                            projectName:
                              projects.find((p) => p.id === g.projectId)?.name ?? g.projectId,
                            role: g.role ?? "operator",
                          }))}
                        projectsAvailable={projects.length > 0}
                        onAssign={() => {
                          setAssignTeamId(t.id)
                          setAssignTeamName(t.name)
                        }}
                        onRemove={(teamId, projectId) => {
                          const projectName =
                            projects.find((p) => p.id === projectId)?.name ?? projectId
                          if (
                            !window.confirm(
                              `Remove "${t.name}" from project "${projectName}"? This will revoke the team's access.`
                            )
                          )
                            return
                          setRemovingProjectId(projectId)
                          fetch("/api/org/teams/access", {
                            method: "DELETE",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ teamId, projectId }),
                          })
                            .then((res) => {
                              if (!res.ok) return res.json().then((j) => Promise.reject(j))
                              setMessage({ type: "success", text: "Assignment removed" })
                              load()
                            })
                            .catch((json) =>
                              setMessage({
                                type: "error",
                                text: (json?.error as string) ?? "Failed to remove assignment",
                              })
                            )
                            .finally(() => setRemovingProjectId(null))
                        }}
                        removingProjectId={removingProjectId}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Assign team to project"
                                onClick={() => {
                                  setAssignTeamId(t.id)
                                  setAssignTeamName(t.name)
                                }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <FolderPlus className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Assign to project</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                href={`/settings/teams/${t.id}`}
                                className="inline-flex items-center justify-center rounded-md hover:bg-muted/50"
                                aria-label="Manage team"
                              >
                                <UsersRound className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>Manage team</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete team"
                          onClick={() => {
                            if (window.confirm(`Delete team "${t.name}"? This cannot be undone.`)) {
                              handleDeleteTeam(t.id)
                            }
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
            </div>
          )}
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader className="pb-12">
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>
              Create a new team to manage permissions for a group of users.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="create-name" className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="create-name"
                placeholder="My Team"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={createLoading}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="create-desc" className="text-xs font-medium text-muted-foreground">
                Description (optional)
              </label>
              <Input
                id="create-desc"
                placeholder="Team description"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                disabled={createLoading}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createLoading || !createName.trim()}
              >
                {createLoading ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AssignTeamProjectDialog
        open={assignTeamId !== null}
        onOpenChange={(o) => !o && setAssignTeamId(null)}
        teamId={assignTeamId ?? ""}
        teamName={assignTeamName}
        projects={projects}
        existingProjectIds={
          assignTeamId
            ? new Set(
                grants.filter((g) => g.teamId === assignTeamId).map((g) => g.projectId)
              )
            : new Set()
        }
        onSuccess={load}
      />
    </div>
  )
}
