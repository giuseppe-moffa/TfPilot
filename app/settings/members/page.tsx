"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type OrgMembersResponse = {
  org: { id: string; slug: string; name: string }
  members: {
    login: string
    display_name: string | null
    avatar_url: string | null
    role: string
    joinedAt: string
  }[]
}

const ROLES = ["viewer", "developer", "approver", "admin"] as const

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function loadMembers(): Promise<OrgMembersResponse | null> {
  return fetch("/api/org/members", { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
}

export default function MembersPage() {
  const [data, setData] = React.useState<OrgMembersResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [addMemberLogin, setAddMemberLogin] = React.useState("")
  const [addMemberRole, setAddMemberRole] = React.useState<string>("viewer")
  const [addMemberSubmitting, setAddMemberSubmitting] = React.useState(false)
  const [addMemberSuccess, setAddMemberSuccess] = React.useState<string | null>(null)
  const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
  const [rowEdits, setRowEdits] = React.useState<Record<string, string>>({})
  const [savingLogin, setSavingLogin] = React.useState<string | null>(null)
  const [removingLogin, setRemovingLogin] = React.useState<string | null>(null)
  const [rowFeedback, setRowFeedback] = React.useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)

  const refreshMembers = React.useCallback(() => {
    return loadMembers().then((json) => {
      if (json) {
        setData(json)
        setRowEdits({})
      }
    })
  }, [])

  const handleAddMemberSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const formData = new FormData(e.currentTarget)
      const login = (formData.get("login") ?? "").toString().trim().toLowerCase()
      if (!login) {
        setAddMemberError("GitHub login is required")
        return
      }
      setAddMemberSubmitting(true)
      setAddMemberError(null)
      setAddMemberSuccess(null)
      try {
        const res = await fetch("/api/org/members", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login, role: addMemberRole }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setAddMemberError((json as { error?: string }).error ?? "Failed to add member")
          return
        }
        setAddMemberSuccess(`${login} is now ${addMemberRole}`)
        setAddMemberLogin("")
        setAddMemberRole("viewer")
        setAddMemberOpen(false)
        await refreshMembers()
      } catch {
        setAddMemberError("Failed to add member")
      } finally {
        setAddMemberSubmitting(false)
      }
    },
    [addMemberRole, refreshMembers]
  )

  const handleSaveRole = React.useCallback(
    async (login: string) => {
      const newRole = rowEdits[login] ?? ""
      if (!newRole) return
      setSavingLogin(login)
      setRowFeedback(null)
      try {
        const res = await fetch("/api/org/members", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login, role: newRole }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setRowFeedback({
            type: "error",
            message: (json as { error?: string }).error ?? "Failed to update role",
          })
          return
        }
        setRowFeedback({ type: "success", message: `${login} role updated to ${newRole}` })
        setRowEdits((prev) => {
          const next = { ...prev }
          delete next[login]
          return next
        })
        await refreshMembers()
      } catch {
        setRowFeedback({ type: "error", message: "Failed to update role" })
      } finally {
        setSavingLogin(null)
      }
    },
    [rowEdits, refreshMembers]
  )

  const handleRemove = React.useCallback(
    async (login: string) => {
      setRemovingLogin(login)
      setRowFeedback(null)
      try {
        const res = await fetch("/api/org/members", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setRowFeedback({
            type: "error",
            message: (json as { error?: string }).error ?? "Failed to remove member",
          })
          return
        }
        setRowFeedback({ type: "success", message: `${login} removed` })
        setRowEdits((prev) => {
          const next = { ...prev }
          delete next[login]
          return next
        })
        await refreshMembers()
      } catch {
        setRowFeedback({ type: "error", message: "Failed to remove member" })
      } finally {
        setRemovingLogin(null)
      }
    },
    [refreshMembers]
  )

  React.useEffect(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    fetch("/api/org/members", { credentials: "include" })
      .then((res) => {
        if (res.status === 401 || res.status === 404 || res.status === 403) {
          setForbidden(true)
          return null
        }
        if (!res.ok) {
          setError("Failed to load members")
          return null
        }
        return res.json()
      })
      .then((json: OrgMembersResponse | null) => {
        if (json) setData(json)
      })
      .catch(() => setError("Failed to load members"))
      .finally(() => setLoading(false))
  }, [])

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
          {error ?? "You don't have permission to view members."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  const { members } = data

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Manage members</h3>
            <p className="text-xs text-muted-foreground">
              Manage organization members and their roles
            </p>
          </div>
          <Button
            size="lg"
            className="cursor-pointer shrink-0 gap-2"
            onClick={() => {
              setAddMemberOpen(true)
              setAddMemberLogin("")
              setAddMemberRole("viewer")
            }}
          >
            <Plus className="h-4 w-4" />
            Add member
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
        {addMemberSuccess && (
          <p className="mb-3 text-sm text-green-600 dark:text-green-500">{addMemberSuccess}</p>
        )}
        {addMemberError && (
          <p className="mb-3 text-sm text-destructive">{addMemberError}</p>
        )}
        {rowFeedback && (
          <p
            className={`mb-3 text-sm ${
              rowFeedback.type === "success"
                ? "text-green-600 dark:text-green-500"
                : "text-destructive"
            }`}
          >
            {rowFeedback.message}
          </p>
        )}
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const effectiveRole = rowEdits[m.login] ?? m.role
                const hasRoleChange = effectiveRole !== m.role
                const isBusy = savingLogin === m.login || removingLogin === m.login
                return (
                  <TableRow key={m.login}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {m.avatar_url ? (
                          <img
                            src={m.avatar_url}
                            alt=""
                            className="h-8 w-8 rounded-full"
                            width={32}
                            height={32}
                          />
                        ) : null}
                        <div>
                          {m.display_name ? (
                            <>
                              <div className="font-medium">{m.display_name}</div>
                              <div className="text-sm text-muted-foreground">@{m.login}</div>
                            </>
                          ) : (
                            <span className="font-medium">{m.login}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={effectiveRole}
                        onValueChange={(v) =>
                          setRowEdits((prev) => ({ ...prev, [m.login]: v }))
                        }
                        disabled={isBusy}
                      >
                        <SelectTrigger className="w-28" type="button">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(m.joinedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {hasRoleChange && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleSaveRole(m.login)}
                          >
                            {savingLogin === m.login ? "Saving…" : "Save"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => handleRemove(m.login)}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingLogin === m.login ? "Removing…" : "Remove"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        </div>
      </Card>

      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent>
          <DialogHeader className="pb-12">
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Add a new member to the organization. Enter their GitHub login and assign a role.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddMemberSubmit} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="add-member-login" className="text-xs font-medium text-muted-foreground">
                GitHub login
              </label>
              <Input
                id="add-member-login"
                name="login"
                value={addMemberLogin}
                onChange={(e) => setAddMemberLogin(e.target.value)}
                placeholder="username"
                disabled={addMemberSubmitting}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="add-member-role" className="text-xs font-medium text-muted-foreground">
                Role
              </label>
              <Select value={addMemberRole} onValueChange={setAddMemberRole} disabled={addMemberSubmitting}>
                <SelectTrigger id="add-member-role" type="button">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addMemberError && (
              <p className="text-sm text-destructive">{addMemberError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddMemberOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={addMemberSubmitting || !addMemberLogin.trim()}
              >
                {addMemberSubmitting ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
