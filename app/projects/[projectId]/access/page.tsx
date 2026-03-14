"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Loader2, Plus, Trash2, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PROJECT_ROLES = ["viewer", "planner", "operator", "deployer", "admin"] as const

type Project = { id: string; project_key: string; name: string }

type RoleAssignment = { users: { login: string; role: string }[]; teams: { teamId: string; role: string }[] }

type Team = { id: string; name: string; slug: string }
type OrgMember = { login: string; display_name: string | null; role: string }

export default function ProjectAccessPage() {
  const params = useParams()
  const projectIdParam = params?.projectId as string | undefined

  const [project, setProject] = React.useState<Project | null>(null)
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [roles, setRoles] = React.useState<RoleAssignment | null>(null)
  const [teams, setTeams] = React.useState<Team[]>([])
  const [orgMembers, setOrgMembers] = React.useState<OrgMember[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [addUserOpen, setAddUserOpen] = React.useState(false)
  const [addTeamOpen, setAddTeamOpen] = React.useState(false)
  const [addUserLogin, setAddUserLogin] = React.useState("")
  const [addUserRole, setAddUserRole] = React.useState<string>("operator")
  const [addTeamId, setAddTeamId] = React.useState("")
  const [addTeamRole, setAddTeamRole] = React.useState<string>("operator")
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [removingUser, setRemovingUser] = React.useState<string | null>(null)
  const [removingTeamId, setRemovingTeamId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!projectIdParam) return
    setLoading(true)
    try {
      const [projectRes, rolesRes, teamsRes, membersRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectIdParam)}`),
        fetch(`/api/org/projects/${encodeURIComponent(projectIdParam)}/roles`),
        fetch("/api/org/teams"),
        fetch("/api/org/members"),
      ])
      const projectData = projectRes.ok ? await projectRes.json() : null
      const rolesData = rolesRes.ok ? await rolesRes.json() : null
      const teamsData = teamsRes.ok ? await teamsRes.json() : null
      const membersData = membersRes.ok ? await membersRes.json() : null

      if (!projectData?.project) {
        setError("Project not found")
        setLoading(false)
        return
      }
      setProject(projectData.project)
      setProjectId(projectData.project.id)
      setRoles(rolesData ?? { users: [], teams: [] })
      setTeams(teamsData?.teams ?? [])
      setOrgMembers(membersData?.members ?? [])
      setError(null)
    } catch {
      setError("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [projectIdParam])

  React.useEffect(() => {
    load()
  }, [load])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId || !addUserLogin.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/org/projects/${encodeURIComponent(projectIdParam!)}/users`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: addUserLogin.trim(), role: addUserRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError((json.error as string) ?? "Failed to add user")
        return
      }
      setAddUserOpen(false)
      setAddUserLogin("")
      setAddUserRole("operator")
      load()
    } catch {
      setSubmitError("Failed to add user")
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId || !addTeamId.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch("/api/org/teams/access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: addTeamId, projectId, role: addTeamRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError((json.error as string) ?? "Failed to add team")
        return
      }
      setAddTeamOpen(false)
      setAddTeamId("")
      setAddTeamRole("operator")
      load()
    } catch {
      setSubmitError("Failed to add team")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemoveUser = async (login: string) => {
    if (!projectId) return
    if (!window.confirm(`Remove ${login} from this project?`)) return
    setRemovingUser(login)
    try {
      const res = await fetch(
        `/api/org/projects/${encodeURIComponent(projectIdParam!)}/users/${encodeURIComponent(login)}`,
        { method: "DELETE", credentials: "include" }
      )
      if (res.ok) load()
    } finally {
      setRemovingUser(null)
    }
  }

  const handleRemoveTeam = async (teamId: string) => {
    if (!projectId) return
    const team = teams.find((t) => t.id === teamId)
    if (!window.confirm(`Remove "${team?.name ?? teamId}" from this project?`)) return
    setRemovingTeamId(teamId)
    try {
      const res = await fetch("/api/org/teams/access", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, projectId }),
      })
      if (res.ok) load()
    } finally {
      setRemovingTeamId(null)
    }
  }

  const existingTeamIds = new Set((roles?.teams ?? []).map((t) => t.teamId))
  const teamsAvailable = teams.filter((t) => !existingTeamIds.has(t.id))

  if (loading || !projectIdParam) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
        <p className="text-sm text-destructive">{error ?? "Project not found"}</p>
        <Button variant="outline" asChild>
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <Card>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <UsersRound className="h-4 w-4" />
                Direct user roles
              </h3>
              <p className="text-xs text-muted-foreground">
                Users with explicit roles on this project
              </p>
            </div>
            <Button size="sm" onClick={() => setAddUserOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add user
            </Button>
          </div>
        </div>
        <div className="px-6 pb-6">
          {(roles?.users?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No direct user assignments</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles?.users ?? []).map((u) => (
                  <TableRow key={u.login}>
                    <TableCell className="font-medium">{u.login}</TableCell>
                    <TableCell>{u.role}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${u.login}`}
                        disabled={removingUser === u.login}
                        onClick={() => handleRemoveUser(u.login)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Card>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">Team roles</h3>
              <p className="text-xs text-muted-foreground">
                Teams with access to this project
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setAddTeamOpen(true)}
              disabled={teamsAvailable.length === 0}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add team
            </Button>
          </div>
        </div>
        <div className="px-6 pb-6">
          {(roles?.teams?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No team assignments.{" "}
              {teams.length === 0 && (
                <Link href="/settings/teams" className="text-primary hover:underline">
                  Create teams in Settings
                </Link>
              )}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles?.teams ?? []).map((t) => (
                  <TableRow key={t.teamId}>
                    <TableCell className="font-medium">
                      {teams.find((x) => x.id === t.teamId)?.name ?? t.teamId}
                    </TableCell>
                    <TableCell>{t.role}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove team`}
                        disabled={removingTeamId === t.teamId}
                        onClick={() => handleRemoveTeam(t.teamId)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user to project</DialogTitle>
            <DialogDescription>
              Assign a direct role to a user. Enter their GitHub login.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-user-login">GitHub login</Label>
              <Input
                id="add-user-login"
                value={addUserLogin}
                onChange={(e) => setAddUserLogin(e.target.value)}
                placeholder="octocat"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-user-role">Role</Label>
              <Select value={addUserRole} onValueChange={setAddUserRole}>
                <SelectTrigger id="add-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !addUserLogin.trim()}>
                {submitting ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addTeamOpen} onOpenChange={setAddTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add team to project</DialogTitle>
            <DialogDescription>
              Assign a team with a role. Teams inherit access for all their members.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddTeam} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-team">Team</Label>
              <Select value={addTeamId} onValueChange={setAddTeamId} disabled={teamsAvailable.length === 0}>
                <SelectTrigger id="add-team">
                  <SelectValue
                    placeholder={
                      teamsAvailable.length === 0
                        ? teams.length === 0
                          ? "No teams in org"
                          : "All teams already assigned"
                        : "Select team"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {teamsAvailable.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-team-role">Role</Label>
              <Select value={addTeamRole} onValueChange={setAddTeamRole}>
                <SelectTrigger id="add-team-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddTeamOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !addTeamId.trim() || teamsAvailable.length === 0}
              >
                {submitting ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
