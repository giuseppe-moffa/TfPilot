"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ManageTeamForm } from "@/components/teams/ManageTeamForm"
import { TeamMembersTable } from "@/components/teams/TeamMembersTable"
import { AddTeamMemberDialog } from "@/components/teams/AddTeamMemberDialog"

type TeamDetail = {
  id: string
  slug: string
  name: string
  description: string | null
  createdAt: string
  members: { login: string }[]
}

type OrgMember = {
  login: string
  display_name: string | null
  avatar_url: string | null
  role: string
}

type OrgMembersResponse = {
  org: { id: string; slug: string; name: string }
  members: OrgMember[]
}

async function fetchTeam(
  teamId: string
): Promise<{ team: TeamDetail | null; forbidden?: boolean }> {
  const res = await fetch(`/api/org/teams/${teamId}`, { credentials: "include" })
  if (res.status === 401 || res.status === 403) return { team: null, forbidden: true }
  if (!res.ok) return { team: null }
  const json = await res.json()
  return { team: json.team ?? null }
}

async function fetchOrgMembers(): Promise<OrgMembersResponse | null> {
  const res = await fetch("/api/org/members", { credentials: "include" })
  if (!res.ok) return null
  return res.json()
}

export default function TeamDetailPage() {
  const params = useParams()
  const teamId = typeof params.teamId === "string" ? params.teamId : ""

  const [team, setTeam] = React.useState<TeamDetail | null>(null)
  const [orgMembers, setOrgMembers] = React.useState<OrgMember[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(
    null
  )

  const [draftName, setDraftName] = React.useState("")
  const [draftDescription, setDraftDescription] = React.useState("")
  const [hasEdits, setHasEdits] = React.useState(false)

  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [addLoading, setAddLoading] = React.useState(false)
  const [removingLogin, setRemovingLogin] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    if (!teamId) return
    setLoading(true)
    setError(null)
    setForbidden(false)
    Promise.all([fetchTeam(teamId), fetchOrgMembers()])
      .then(([teamResult, membersData]) => {
        if (teamResult.forbidden) {
          setForbidden(true)
          return
        }
        if (!teamResult.team) {
          setError("Team not found")
          return
        }
        const teamData = teamResult.team
        setTeam(teamData)
        setDraftName(teamData.name)
        setDraftDescription(teamData.description?.trim() ?? "")
        setOrgMembers(membersData?.members ?? [])
      })
      .catch(() => setError("Failed to load team"))
      .finally(() => setLoading(false))
  }, [teamId])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    if (!team) return
    setHasEdits(
      draftName !== team.name ||
        draftDescription !== (team.description?.trim() ?? "")
    )
  }, [team, draftName, draftDescription])

  const handleDiscard = () => {
    if (team) {
      setDraftName(team.name)
      setDraftDescription(team.description?.trim() ?? "")
      setMessage(null)
    }
  }

  const [saveLoading, setSaveLoading] = React.useState(false)

  const handleSave = async () => {
    if (!team || !hasEdits) return
    setSaveLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/org/teams/${teamId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName.trim(),
          description: draftDescription.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({
          type: "error",
          text: (json.error as string) ?? "Failed to save changes",
        })
        return
      }
      setMessage({ type: "success", text: "Changes saved" })
      setTeam((prev) =>
        prev
          ? {
              ...prev,
              name: draftName.trim(),
              description: draftDescription.trim() || null,
            }
          : null
      )
      setHasEdits(false)
    } catch {
      setMessage({ type: "error", text: "Failed to save changes" })
    } finally {
      setSaveLoading(false)
    }
  }

  const handleAddMember = async (login: string) => {
    setAddLoading(true)
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
        throw new Error((json.error as string) ?? "Failed to add member")
      }
      setMessage({ type: "success", text: "Member added" })
      load()
    } catch (err) {
      throw err
    } finally {
      setAddLoading(false)
    }
  }

  const handleRemoveMember = async (login: string) => {
    if (!window.confirm(`Remove ${login} from this team?`)) return
    setRemovingLogin(login)
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
        setMessage({
          type: "error",
          text: (json.error as string) ?? "Failed to remove member",
        })
        return
      }
      setMessage({ type: "success", text: "Member removed" })
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to remove member" })
    } finally {
      setRemovingLogin(null)
    }
  }

  const membersWithMeta = React.useMemo(() => {
    if (!team) return []
    return team.members.map((m) => {
      const om = orgMembers.find((o) => o.login === m.login)
      return {
        login: m.login,
        displayName: om?.display_name ?? null,
        avatarUrl: om?.avatar_url ?? `https://github.com/${m.login}.png`,
        orgRole: om?.role,
      }
    })
  }, [team, orgMembers])

  const availableMembers = React.useMemo(() => {
    if (!team) return []
    const teamLogins = new Set(team.members.map((m) => m.login))
    return orgMembers.filter((m) => !teamLogins.has(m.login))
  }, [team, orgMembers])

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

  if (forbidden || error || !team) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">
          {error ?? "You don't have permission to view this team."}
        </p>
      </Card>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Manage Team</h3>
            <p className="text-xs text-muted-foreground">
              Edit team details and manage members.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDiscard}
              disabled={!hasEdits}
            >
              Discard Changes
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasEdits || saveLoading}
            >
              {saveLoading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2 space-y-6">
          <div>
            <h4 className="mb-3 text-sm font-medium">Details</h4>
            <ManageTeamForm
              name={draftName}
              description={draftDescription}
              onNameChange={setDraftName}
              onDescriptionChange={setDraftDescription}
              disabled={false}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-medium">Members</h4>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setAddMemberOpen(true)}
                disabled={availableMembers.length === 0}
              >
                <UserPlus className="h-4 w-4" />
                Add User
              </Button>
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
            <TeamMembersTable
              members={membersWithMeta}
              onRemove={handleRemoveMember}
              removingLogin={removingLogin}
            />
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">Project Assignments</h4>
            <p className="text-sm text-muted-foreground">
              Team roles are per project. Assign this team to projects from the Teams list.
            </p>
          </div>
        </div>
      </Card>

      <AddTeamMemberDialog
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        teamName={team.name}
        availableMembers={availableMembers}
        onAdd={handleAddMember}
        loading={addLoading}
      />
    </div>
  )
}
