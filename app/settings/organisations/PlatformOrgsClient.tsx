"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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

type OrgWithCount = {
  id: string
  slug: string
  name: string
  createdAt: string
  memberCount: number
  archivedAt: string | null
}

type OrgsResponse = {
  orgs: OrgWithCount[]
}

type FilterValue = "active" | "archived" | "all"

function formatTimestamp(iso?: string) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

async function fetchOrgs(filter: FilterValue): Promise<{
  data?: OrgsResponse
  forbidden?: boolean
  error?: boolean
}> {
  const url = `/api/platform/orgs${filter !== "active" ? `?filter=${encodeURIComponent(filter)}` : ""}`
  const res = await fetch(url, { credentials: "include" })
  if (res.status === 401 || res.status === 404 || res.status === 403) {
    return { forbidden: true }
  }
  if (!res.ok) return { error: true }
  const data = (await res.json()) as OrgsResponse
  return { data }
}

export default function PlatformOrgsClient() {
  const [data, setData] = React.useState<OrgsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(
    null
  )
  const [createSlug, setCreateSlug] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createAdminLogin, setCreateAdminLogin] = React.useState("")
  const [createLoading, setCreateLoading] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<FilterValue>("active")
  const [archivingId, setArchivingId] = React.useState<string | null>(null)
  const [restoringId, setRestoringId] = React.useState<string | null>(null)
  const router = useRouter()

  const load = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    fetchOrgs(filter)
      .then((result) => {
        if (result.forbidden) setForbidden(true)
        else if (result.error) setError("Failed to load orgs")
        else if (result.data) setData(result.data)
      })
      .catch(() => setError("Failed to load orgs"))
      .finally(() => setLoading(false))
  }, [filter])

  React.useEffect(() => {
    load()
  }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createSlug.trim() || !createName.trim() || !createAdminLogin.trim()) return
    setCreateLoading(true)
    setMessage(null)
    try {
      const res = await fetch("/api/platform/orgs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: createSlug.trim().toLowerCase(),
          name: createName.trim(),
          adminLogin: createAdminLogin.trim().toLowerCase(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to create org" })
        return
      }
      setMessage({ type: "success", text: "Org created" })
      setCreateSlug("")
      setCreateName("")
      setCreateAdminLogin("")
      setCreateOpen(false)
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to create org" })
    } finally {
      setCreateLoading(false)
    }
  }

  const handleArchive = async (e: React.MouseEvent, orgId: string) => {
    e.stopPropagation()
    setArchivingId(orgId)
    setMessage(null)
    try {
      const res = await fetch(`/api/platform/orgs/${encodeURIComponent(orgId)}/archive`, {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to archive org" })
        return
      }
      setMessage({ type: "success", text: "Org archived" })
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to archive org" })
    } finally {
      setArchivingId(null)
    }
  }

  const handleRestore = async (e: React.MouseEvent, orgId: string) => {
    e.stopPropagation()
    setRestoringId(orgId)
    setMessage(null)
    try {
      const res = await fetch(`/api/platform/orgs/${encodeURIComponent(orgId)}/restore`, {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ type: "error", text: json.error ?? "Failed to restore org" })
        return
      }
      setMessage({ type: "success", text: "Org restored" })
      load()
    } catch {
      setMessage({ type: "error", text: "Failed to restore org" })
    } finally {
      setRestoringId(null)
    }
  }

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
        <p className="text-sm text-muted-foreground">
          {error ?? "You don't have permission to view organisations."}
        </p>
      </Card>
    )
  }

  if (!data) return null

  const { orgs } = data

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <h3 className="text-base font-semibold">Manage Organisations</h3>
            <p className="text-xs text-muted-foreground">
              View and create organizations on the platform.
            </p>
          </div>
          <Button
            size="lg"
            className="cursor-pointer shrink-0 gap-2"
            onClick={() => {
              setCreateOpen(true)
              setCreateSlug("")
              setCreateName("")
              setCreateAdminLogin("")
            }}
          >
            <Plus className="h-4 w-4" />
            Create org
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {(["active", "archived", "all"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>

          {message && (
            <p
              className={
                message.type === "success"
                  ? "mb-3 text-sm text-emerald-600 dark:text-emerald-500"
                  : "mb-3 text-sm text-destructive"
              }
            >
              {message.text}
            </p>
          )}

          {orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "active"
                ? "No active orgs."
                : filter === "archived"
                  ? "No archived orgs."
                  : "No orgs yet."}
            </p>
          ) : (
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => (
                <TableRow
                  key={o.id}
                  className={`cursor-pointer hover:bg-muted/50 ${o.archivedAt ? "opacity-75" : ""}`}
                  onClick={() => router.push(`/settings/organisations/${encodeURIComponent(o.id)}`)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {o.name}
                      {o.archivedAt && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{o.id}</TableCell>
                  <TableCell>{o.memberCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(o.createdAt)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {o.archivedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!restoringId}
                        onClick={(e) => handleRestore(e, o.id)}
                      >
                        {restoringId === o.id ? "Restoring…" : "Restore"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!archivingId}
                        onClick={(e) => handleArchive(e, o.id)}
                      >
                        {archivingId === o.id ? "Archiving…" : "Archive"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organisation</DialogTitle>
            <DialogDescription>
              Create a new organisation on the platform. You must specify an initial admin GitHub login.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="create-slug" className="text-xs font-medium text-muted-foreground">
                Slug
              </label>
              <Input
                id="create-slug"
                placeholder="acme"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                disabled={createLoading}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="create-name" className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="create-name"
                placeholder="Acme"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={createLoading}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="create-admin-login" className="text-xs font-medium text-muted-foreground">
                Initial admin GitHub login
              </label>
              <Input
                id="create-admin-login"
                placeholder="someuser"
                value={createAdminLogin}
                onChange={(e) => setCreateAdminLogin(e.target.value)}
                disabled={createLoading}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createLoading ||
                  !createSlug.trim() ||
                  !createName.trim() ||
                  !createAdminLogin.trim()
                }
              >
                {createLoading ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
