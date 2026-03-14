"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, Search, Download } from "lucide-react"

import { ModuleTag } from "@/components/icons/module-icon"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type WorkspaceTemplate = {
  id: string
  label?: string
  description?: string
  modules: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  version?: number
}

export default function WorkspaceTemplatesPage() {
  const [templates, setTemplates] = React.useState<WorkspaceTemplate[]>([])
  const [search, setSearch] = React.useState("")
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [templatesError, setTemplatesError] = React.useState<string | null>(null)
  const [notInitialized, setNotInitialized] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [isAdminView, setIsAdminView] = React.useState(false)
  const [seeding, setSeeding] = React.useState(false)
  const [seedResult, setSeedResult] = React.useState<
    { created?: string[] } | { alreadyInitialized: true } | null
  >(null)
  const [seedError, setSeedError] = React.useState<string | null>(null)

  const loadTemplates = React.useCallback(async () => {
    setLoadingTemplates(true)
    setTemplatesError(null)
    setNotInitialized(false)
    try {
      const res = await fetch("/api/workspace-templates")
      if (res.status === 401) {
        setNotFound(true)
        return
      }
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}))
        if (
          data?.error === "WORKSPACE_TEMPLATES_NOT_INITIALIZED" ||
          data?.error === "ENV_TEMPLATES_NOT_INITIALIZED"
        ) {
          setNotInitialized(true)
          setTemplates([])
        } else {
          setTemplatesError("Workspace templates are not initialized. Ask an admin to run the seed.")
          setTemplates([])
        }
        return
      }
      if (!res.ok) {
        setTemplatesError("Failed to load templates")
        setTemplates([])
        return
      }
      const data = await res.json()
      setTemplates(Array.isArray(data) ? data : [])
    } catch {
      setTemplatesError("Failed to load templates")
      setTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  React.useEffect(() => {
    fetch("/api/workspace-templates/admin")
      .then((res) => {
        if (res.ok) setIsAdminView(true)
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.label ?? "").toLowerCase().includes(q)
    )
  }, [templates, search])

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    setSeedError(null)
    try {
      const res = await fetch("/api/workspace-templates/admin/seed", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.status === 404) {
        throw new Error("You don't have access to run the seed.")
      }
      if (
        res.status === 409 &&
        (data?.error === "WORKSPACE_TEMPLATES_ALREADY_INITIALIZED" ||
          data?.error === "ENV_TEMPLATES_ALREADY_INITIALIZED")
      ) {
        setSeedResult({ alreadyInitialized: true })
      } else if (!res.ok) {
        const msg =
          [data?.error, data?.detail].filter(Boolean).join(": ") ||
          `Workspace templates seed failed (${res.status})`
        throw new Error(msg)
      } else {
        setSeedResult({ created: data?.created ?? [] })
      }
      await loadTemplates()
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : "Seed failed")
      setSeedResult(null)
    } finally {
      setSeeding(false)
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Sign in to browse templates</h1>
        <p className="text-muted-foreground text-center">
          You need to be signed in to view the template catalogue.
        </p>
        <Link href="/login">
          <Button variant="outline">Sign in</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          {isAdminView && seedError && (
            <p className="text-sm text-destructive">{seedError}</p>
          )}
          {isAdminView && seedResult && !seedError && (
            <p className="text-sm text-muted-foreground">
              Import:{" "}
              {"alreadyInitialized" in seedResult
                ? "already initialized"
                : `${("created" in seedResult ? seedResult.created?.length : 0) ?? 0} created`}
            </p>
          )}

          <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Workspace Templates</h2>
            <div className="flex items-center gap-2">
              {isAdminView && (
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
              )}
              <Button size="sm" asChild>
                <Link href="/workspaces/new">New Workspace</Link>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Use these templates when creating new workspaces
          </p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by label or id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {templatesError && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-destructive">{templatesError}</p>
              <Button variant="outline" size="sm" onClick={loadTemplates} className="w-fit">
                Retry
              </Button>
            </div>
          )}
          {!templatesError && loadingTemplates ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !templatesError && filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {notInitialized
                ? "Workspace templates are not initialized. Ask an admin to run the seed."
                : templates.length === 0
                  ? "No enabled templates."
                  : "No templates match your search."}
            </div>
          ) : !templatesError ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((t) => (
                <Card
                  key={t.id}
                  className="flex flex-col gap-3 border border-border p-4 transition hover:bg-slate-50 hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-foreground">{t.label ?? t.id}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(t.modules?.length ?? 0) === 0 ? (
                          <span className="inline-block bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            No modules
                          </span>
                        ) : (
                          [...(t.modules ?? [])]
                            .sort((a, b) => a.order - b.order)
                            .map((m) => (
                              <span
                                key={m.module}
                                className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                <ModuleTag module={m.module} />
                              </span>
                            ))
                        )}
                      </div>
                    </div>
                  </div>
                  {t.description ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  ) : null}
                  <div className="mt-auto flex gap-2">
                    <Link href={`/catalogue/workspaces/${t.id}`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <Eye className="h-3 w-3" />
                        View
                      </Button>
                    </Link>
                    <Link href={`/workspaces/new?template_id=${t.id}`}>
                      <Button size="sm">Use template</Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
