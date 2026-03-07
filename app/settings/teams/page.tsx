"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

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

type TeamWithMembers = {
  id: string
  slug: string
  name: string
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

type Grant = { teamId: string; projectId: string }

type AccessResponse = {
  grants: Grant[]
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

export default function TeamsPage() {
  const [data, setData] = React.useState<TeamsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(
    null
  )

  const [createSlug, setCreateSlug] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createLoading, setCreateLoading] = React.useState(false)

  const [addMemberLogins, setAddMemberLogins] = React.useState<Record<string, string>>({})
  const [addLoading, setAddLoading] = React.useState<Record<string, boolean>>({})
  const [removeLoading, setRemoveLoading] = React.useState<Record<string, boolean>>({})

  const [projects, setProjects] = React.useState<ProjectSummary[]>([])
  const [grants, setGrants] = React.useState<Grant[]>([])
  const [projectAccessLoading, setProjectAccessLoading] = React.useState<Record<string, boolean>>({})
  const [projectAccessMessage, setProjectAccessMessage] = React.useState<{
    teamId: string
    type: "success" | "error"
    text: string
  } | null>(null)

  const load = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    Promise.all([fetchTeams(), fetchProjects(), fetchAccess()])
      .then(([teamsResult, projectsList, grantsList]) => {
        if (teamsResult.forbidden) setForbidden(true)
        else if (teamsResult.error) setError("Failed to load teams")
        else if (teamsResult.data) setData(teamsResult.data)
        if (!teamsResult.forbidden) {
          setProjects(projectsList)
          setGrants(grantsList)
        }
      })
      .catch(() => setError("Failed to load teams"))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createSlug.trim() || !createName.trim()) return
    setCreateLoading(true)
    setMessage(null)
    try {
      const res = await fetch("/api/org/teams", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: createSlug.trim(), name: createName.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to create team" })
        return
      }
      setMessage({ type: "success", text: "Team created" })
      setCreateSlug("")
      setCreateName("")
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to create team" })
    } finally {
      setCreateLoading(false)
    }
  }

  const handleAddMember = async (teamId: string) => {
    const login = addMemberLogins[teamId]?.trim()
    if (!login) return
    setAddLoading((prev) => ({ ...prev, [teamId]: true }))
    setMessage(null)
    try {
      const res = await fetch(`/api/org/teams/${teamId}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to add member" })
        return
      }
      setMessage({ type: "success", text: "Member added" })
      setAddMemberLogins((prev) => ({ ...prev, [teamId]: "" }))
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to add member" })
    } finally {
      setAddLoading((prev) => ({ ...prev, [teamId]: false }))
    }
  }

  const hasProjectAccess = (teamId: string, projectId: string) =>
    grants.some((g) => g.teamId === teamId && g.projectId === projectId)

  const handleProjectAccessToggle = async (teamId: string, projectId: string, checked: boolean) => {
    const key = `${teamId}:${projectId}`
    setProjectAccessLoading((prev) => ({ ...prev, [key]: true }))
    setProjectAccessMessage(null)
    try {
      const res = await fetch("/api/org/teams/access", {
        method: checked ? "POST" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, projectId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProjectAccessMessage({
          teamId,
          type: "error",
          text: (json.error as string) ?? "Failed to update access",
        })
        return
      }
      setProjectAccessMessage({
        teamId,
        type: "success",
        text: checked ? "Access granted" : "Access revoked",
      })
      load()
    } catch {
      setProjectAccessMessage({
        teamId,
        type: "error",
        text: "Failed to update access",
      })
    } finally {
      setProjectAccessLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleRemoveMember = async (teamId: string, login: string) => {
    setRemoveLoading((prev) => ({ ...prev, [`${teamId}:${login}`]: true }))
    setMessage(null)
    try {
      const res = await fetch(`/api/org/teams/${teamId}/members`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to remove member" })
        return
      }
      setMessage({ type: "success", text: "Member removed" })
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to remove member" })
    } finally {
      setRemoveLoading((prev) => ({ ...prev, [`${teamId}:${login}`]: false }))
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">Loading teams…</p>
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (forbidden || error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          {error ?? "You don't have permission to view teams."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  const { teams } = data

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Teams</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Teams group members for project access. View teams and member counts below.
        </p>
      </div>

      {message && (
        <p
          className={
            message.type === "success"
              ? "text-sm text-emerald-600 dark:text-emerald-500"
              : "text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}

      <Card className="p-6">
        <h3 className="mb-4 text-sm font-medium">Create team</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="create-slug" className="text-xs text-muted-foreground">
              Slug
            </label>
            <Input
              id="create-slug"
              placeholder="my-team"
              value={createSlug}
              onChange={(e) => setCreateSlug(e.target.value)}
              className="w-40"
              disabled={createLoading}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="create-name" className="text-xs text-muted-foreground">
              Name
            </label>
            <Input
              id="create-name"
              placeholder="My Team"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="w-40"
              disabled={createLoading}
            />
          </div>
          <Button type="submit" disabled={createLoading || !createSlug.trim() || !createName.trim()}>
            {createLoading ? "Creating…" : "Create"}
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => (
                <React.Fragment key={t.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => toggleExpand(t.id)}
                  >
                    <TableCell className="w-8 py-2">
                      {expanded.has(t.id) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.slug}</TableCell>
                    <TableCell>{t.membersCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(t.createdAt)}
                    </TableCell>
                  </TableRow>
                  {expanded.has(t.id) && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/30 p-4">
                        <div className="space-y-3">
                          <div className="text-sm font-medium">Members</div>
                          {t.members.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No members yet.</p>
                          ) : (
                            <ul className="space-y-2">
                              {t.members.map((m) => (
                                <li
                                  key={m.login}
                                  className="flex items-center justify-between gap-2 rounded border bg-background px-3 py-2 text-sm"
                                >
                                  <span>{m.login}</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    disabled={removeLoading[`${t.id}:${m.login}`]}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleRemoveMember(t.id, m.login)
                                    }}
                                  >
                                    {removeLoading[`${t.id}:${m.login}`] ? "Removing…" : "Remove"}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="flex items-center gap-2 pt-2">
                            <Input
                              placeholder="GitHub login"
                              value={addMemberLogins[t.id] ?? ""}
                              onChange={(e) =>
                                setAddMemberLogins((prev) => ({ ...prev, [t.id]: e.target.value }))
                              }
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  handleAddMember(t.id)
                                }
                              }}
                              className="max-w-[200px]"
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={addLoading[t.id] || !(addMemberLogins[t.id]?.trim())}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAddMember(t.id)
                              }}
                            >
                              {addLoading[t.id] ? "Adding…" : "Add"}
                            </Button>
                          </div>
                          <div className="border-t pt-4">
                            <div className="text-sm font-medium mb-2">Project access</div>
                            {projectAccessMessage?.teamId === t.id && (
                              <p
                                className={
                                  projectAccessMessage.type === "success"
                                    ? "text-sm text-emerald-600 dark:text-emerald-500 mb-2"
                                    : "text-sm text-destructive mb-2"
                                }
                              >
                                {projectAccessMessage.text}
                              </p>
                            )}
                            {projects.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No projects in this org.</p>
                            ) : (
                              <ul className="space-y-2">
                                {projects.map((p) => {
                                  const key = `${t.id}:${p.id}`
                                  const checked = hasProjectAccess(t.id, p.id)
                                  const isLoading = projectAccessLoading[key]
                                  return (
                                    <li
                                      key={p.id}
                                      className="flex items-center gap-2 rounded border bg-background px-3 py-2 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        id={key}
                                        className="h-4 w-4"
                                        checked={checked}
                                        disabled={isLoading}
                                        onChange={(e) => {
                                          e.stopPropagation()
                                          handleProjectAccessToggle(t.id, p.id, e.target.checked)
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <label htmlFor={key} className="flex-1 cursor-pointer">
                                        {p.name} ({p.projectKey})
                                      </label>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
