"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Copy, Edit, Eye, Search, Plus, Power, PowerOff, Download, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type TemplateIndexEntry = {
  id: string
  label: string
  project: string
  environment: string
  module: string
  enabled: boolean
  updatedAt: string
  version?: number
}

function fullTemplateToEntry(t: { id: string; label: string; project?: string; environment: string; module: string; enabled?: boolean; updatedAt?: string; version?: number }): TemplateIndexEntry {
  return {
    id: t.id,
    label: t.label,
    project: t.project ?? "",
    environment: t.environment,
    module: t.module,
    enabled: t.enabled ?? true,
    updatedAt: t.updatedAt ?? "",
    version: t.version,
  }
}

export default function TemplatesListPage() {
  const [list, setList] = React.useState<TemplateIndexEntry[]>([])
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [isAdminView, setIsAdminView] = React.useState(false)
  const [actionId, setActionId] = React.useState<string | null>(null)
  const [seeding, setSeeding] = React.useState(false)
  const [seedResult, setSeedResult] = React.useState<{ created: string[]; skipped: string[] } | null>(null)
  const [seedError, setSeedError] = React.useState<string | null>(null)
  const [deleteConfirmEntry, setDeleteConfirmEntry] = React.useState<TemplateIndexEntry | null>(null)

  const loadList = React.useCallback(async () => {
    const adminRes = await fetch("/api/templates/admin")
    if (adminRes.ok) {
      const data = await adminRes.json()
      setList(Array.isArray(data) ? data : [])
      setIsAdminView(true)
      setNotFound(false)
      return
    }
    if (adminRes.status === 404) {
      const publicRes = await fetch("/api/templates")
      if (publicRes.status === 401) {
        setNotFound(true)
        return
      }
      if (publicRes.ok) {
        const data = await publicRes.json()
        const entries = Array.isArray(data) ? data.map((t: { id: string; label: string; project?: string; environment: string; module: string; enabled?: boolean; updatedAt?: string; version?: number }) => fullTemplateToEntry(t)) : []
        setList(entries)
        setIsAdminView(false)
        setNotFound(false)
        return
      }
    }
    setNotFound(true)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    loadList().then(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadList])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.module.toLowerCase().includes(q) ||
        t.project.toLowerCase().includes(q) ||
        t.environment.toLowerCase().includes(q)
    )
  }, [list, search])

  const handleDuplicate = async (entry: TemplateIndexEntry) => {
    setActionId(entry.id)
    try {
      const res = await fetch(`/api/templates/admin/${entry.id}`)
      if (!res.ok) throw new Error("Failed to load template")
      const full = await res.json()
      const payload = {
        label: `${full.label} (copy)`,
        description: full.description,
        project: full.project,
        environment: full.environment,
        module: full.module,
        defaultConfig: full.defaultConfig ?? {},
        uiSchema: full.uiSchema,
        enabled: full.enabled ?? true,
        lockEnvironment: full.lockEnvironment,
        allowCustomProjectEnv: full.allowCustomProjectEnv,
      }
      const createRes = await fetch("/api/templates/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!createRes.ok) throw new Error("Failed to duplicate")
      const created = await createRes.json()
      setList((prev) => [
        ...prev,
        {
          id: created.id,
          label: created.label,
          project: created.project,
          environment: created.environment,
          module: created.module,
          enabled: created.enabled,
          updatedAt: created.updatedAt,
        },
      ])
    } catch (err) {
      console.error(err)
    } finally {
      setActionId(null)
    }
  }

  const handleDisable = async (id: string) => {
    setActionId(id)
    try {
      const res = await fetch(`/api/templates/admin/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to disable")
      const updated = await res.json()
      setList((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: false, updatedAt: updated.updatedAt } : t)))
    } catch (err) {
      console.error(err)
    } finally {
      setActionId(null)
    }
  }

  const handleEnable = async (id: string) => {
    setActionId(id)
    try {
      const res = await fetch(`/api/templates/admin/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) throw new Error("Failed to enable")
      const updated = await res.json()
      setList((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: true, updatedAt: updated.updatedAt } : t)))
    } catch (err) {
      console.error(err)
    } finally {
      setActionId(null)
    }
  }

  const handleDeleteClick = (entry: TemplateIndexEntry) => {
    setDeleteConfirmEntry(entry)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmEntry) return
    const entry = deleteConfirmEntry
    setDeleteConfirmEntry(null)
    setActionId(entry.id)
    try {
      const res = await fetch(`/api/templates/admin/${entry.id}/delete`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to delete")
      setList((prev) => prev.filter((t) => t.id !== entry.id))
    } catch (err) {
      console.error(err)
    } finally {
      setActionId(null)
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    setSeedError(null)
    try {
      const res = await fetch("/api/templates/admin/seed", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          res.status === 404
            ? "You don't have access to run the seed."
            : [data?.error, data?.detail].filter(Boolean).join(": ") || `Seed failed (${res.status})`
        throw new Error(msg)
      }
      setSeedResult(data)
      setSeedError(null)
      await loadList()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Seed failed"
      setSeedError(message)
      setSeedResult({ created: [], skipped: [] })
    } finally {
      setSeeding(false)
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Sign in to browse templates</h1>
        <p className="text-muted-foreground text-center">You need to be signed in to view the template catalogue.</p>
        <Link href="/login">
          <Button variant="outline">Sign in</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/requests">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Catalogue</h1>
            {!loading && !isAdminView && (
              <p className="text-xs text-muted-foreground">Browse the catalogue. Create a request from the Requests page.</p>
            )}
          </div>
        </div>
        {isAdminView && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={seeding}
              onClick={handleSeed}
            >
              <Download className="h-4 w-4" />
              {seeding ? "Importing…" : "Import default templates"}
            </Button>
            <Link href="/catalogue/new">
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                New template
              </Button>
            </Link>
          </div>
        )}
      </header>

      {isAdminView && seedError && (
        <p className="text-sm text-destructive">{seedError}</p>
      )}
      {isAdminView && seedResult && !seedError && (
        <p className="text-sm text-muted-foreground">
          Import: {seedResult.created.length} created, {seedResult.skipped.length} already existed.
        </p>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by label, module, project, environment…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {list.length === 0 ? "No templates yet. Create one to get started." : "No templates match your search."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => (
            <Card key={entry.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-foreground">{entry.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{entry.module || "—"}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {entry.version != null && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                      v{entry.version}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      entry.enabled ? "bg-green-500/20 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {entry.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entry.project?.trim() ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {entry.project}
                  </span>
                ) : null}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {entry.environment}
                </span>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {isAdminView ? (
                  <>
                    <Link href={`/catalogue/${entry.id}`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <Edit className="h-3 w-3" />
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={actionId === entry.id}
                      onClick={() => handleDuplicate(entry)}
                    >
                      <Copy className="h-3 w-3" />
                      Duplicate
                    </Button>
                    {entry.enabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        disabled={actionId === entry.id}
                        onClick={() => handleDisable(entry.id)}
                      >
                        <PowerOff className="h-3 w-3" />
                        Disable
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        disabled={actionId === entry.id}
                        onClick={() => handleEnable(entry.id)}
                      >
                        <Power className="h-3 w-3" />
                        Enable
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={actionId === entry.id}
                      onClick={() => handleDeleteClick(entry)}
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </>
                ) : (
                  <Link href={`/catalogue/${entry.id}`}>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Eye className="h-3 w-3" />
                      View
                    </Button>
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deleteConfirmEntry} onOpenChange={(open) => !open && setDeleteConfirmEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template</DialogTitle>
            <DialogDescription>
              {deleteConfirmEntry ? (
                <>
                  Delete &quot;{deleteConfirmEntry.label}&quot;? This cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmEntry(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
