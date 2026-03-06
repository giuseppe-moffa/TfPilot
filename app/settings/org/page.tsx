"use client"

import * as React from "react"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type OrgMembersResponse = {
  org: { id: string; slug: string; name: string }
  members: { login: string; role: string; joinedAt: string }[]
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

export default function OrgSettingsPage() {
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
          setError("Failed to load org settings")
          return null
        }
        return res.json()
      })
      .then((json: OrgMembersResponse | null) => {
        if (json) setData(json)
      })
      .catch(() => setError("Failed to load org settings"))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (forbidden || error) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">
          {error ?? "You don't have permission to view org settings."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  const { org, members } = data

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Org summary</h2>
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
        </dl>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Members</h2>
        <form onSubmit={handleAddMemberSubmit} className="mb-4 flex flex-wrap items-end gap-3">
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
              className="w-40"
              disabled={addMemberSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-member-role" className="text-xs font-medium text-muted-foreground">
              Role
            </label>
            <Select value={addMemberRole} onValueChange={setAddMemberRole} disabled={addMemberSubmitting}>
              <SelectTrigger id="add-member-role" className="w-32" type="button">
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
          <Button type="submit" disabled={addMemberSubmitting}>
            {addMemberSubmitting ? "Adding…" : "Add member"}
          </Button>
        </form>
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
                <TableHead>GitHub login</TableHead>
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
                    <TableCell className="font-medium">{m.login}</TableCell>
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
      </Card>
    </div>
  )
}
