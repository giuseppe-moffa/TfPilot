"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, Search, Download } from "lucide-react"

import { ModuleTag } from "@/components/icons/module-icon"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type EnvTemplate = {
  id: string
  label?: string
  description?: string
  modules: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  version?: number
}

export default function EnvironmentTemplatesPage() {
  const [envTemplates, setEnvTemplates] = React.useState<EnvTemplate[]>([])
  const [envTemplatesSearch, setEnvTemplatesSearch] = React.useState("")
  const [envTemplatesLoading, setEnvTemplatesLoading] = React.useState(true)
  const [envTemplatesError, setEnvTemplatesError] = React.useState<string | null>(null)
  const [envTemplates503, setEnvTemplates503] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [isAdminView, setIsAdminView] = React.useState(false)
  const [seeding, setSeeding] = React.useState(false)
  const [seedResult, setSeedResult] = React.useState<{ created?: string[] } | { alreadyInitialized: true } | null>(null)
  const [seedError, setSeedError] = React.useState<string | null>(null)

  const loadEnvTemplates = React.useCallback(async () => {
    setEnvTemplatesLoading(true)
    setEnvTemplatesError(null)
    setEnvTemplates503(false)
    try {
      const res = await fetch("/api/environment-templates")
      if (res.status === 401) {
        setNotFound(true)
        return
      }
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}))
        if (data?.error === "ENV_TEMPLATES_NOT_INITIALIZED") {
          setEnvTemplates503(true)
          setEnvTemplates([])
        } else {
          setEnvTemplatesError("Environment templates are not initialized. Ask an admin to run the seed.")
          setEnvTemplates([])
        }
        return
      }
      if (res.status === 500) {
        setEnvTemplatesError("Failed to load templates")
        setEnvTemplates([])
        return
      }
      if (!res.ok) {
        setEnvTemplatesError("Failed to load templates")
        setEnvTemplates([])
        return
      }
      const data = await res.json()
      const arr = Array.isArray(data) ? data : []
      setEnvTemplates(arr)
      setEnvTemplatesError(null)
      setEnvTemplates503(false)
    } catch {
      setEnvTemplatesError("Failed to load templates")
      setEnvTemplates([])
    } finally {
      setEnvTemplatesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    fetch("/api/request-templates/admin")
      .then((res) => {
        if (!cancelled && res.ok) setIsAdminView(true)
        return null
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    loadEnvTemplates()
    return () => { cancelled = true }
  }, [loadEnvTemplates])

  const filteredEnvTemplates = React.useMemo(() => {
    const q = envTemplatesSearch.trim().toLowerCase()
    if (!q) return envTemplates
    return envTemplates.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.label ?? "").toLowerCase().includes(q)
    )
  }, [envTemplates, envTemplatesSearch])

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    setSeedError(null)
    try {
      const envRes = await fetch("/api/environment-templates/admin/seed", { method: "POST" })
      const envData = await envRes.json().catch(() => ({}))
      if (envRes.status === 404) {
        throw new Error("You don't have access to run the seed.")
      }
      if (envRes.status === 409 && envData?.error === "ENV_TEMPLATES_ALREADY_INITIALIZED") {
        setSeedResult({ alreadyInitialized: true })
      } else if (!envRes.ok) {
        const envMsg = [envData?.error, envData?.detail].filter(Boolean).join(": ") || `Environment templates seed failed (${envRes.status})`
        throw new Error(envMsg)
      } else {
        setSeedResult({ created: envData?.created ?? [] })
      }
      setSeedError(null)
      await loadEnvTemplates()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Seed failed"
      setSeedError(message)
      setSeedResult(null)
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          {isAdminView && seedError && (
            <p className="text-sm text-destructive">{seedError}</p>
          )}
          {isAdminView && seedResult && !seedError && (
            <p className="text-sm text-muted-foreground">
              Import: {seedResult && "alreadyInitialized" in seedResult
                ? "already initialized"
                : `${seedResult && "created" in seedResult ? seedResult.created?.length ?? 0 : 0} created`}
            </p>
          )}

          <div className="flex min-h-10 flex-wrap justify-between gap-3">
            <h2 className="text-base font-semibold">Environment Templates</h2>
            {isAdminView ? (
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
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Use these templates when creating new environments</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by label or id…"
              value={envTemplatesSearch}
              onChange={(e) => setEnvTemplatesSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {envTemplatesError && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-destructive">{envTemplatesError}</p>
              {envTemplatesError === "Failed to load templates" && (
                <Button variant="outline" size="sm" onClick={loadEnvTemplates} className="w-fit">
                  Retry
                </Button>
              )}
            </div>
          )}
          {!envTemplatesError && envTemplatesLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !envTemplatesError && filteredEnvTemplates.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {envTemplates503
                ? "Environment templates are not initialized. Ask an admin to run the seed."
                : envTemplates.length === 0
                  ? "No enabled templates."
                  : "No templates match your search."}
            </div>
          ) : !envTemplatesError ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEnvTemplates.map((t) => (
                <Card key={t.id} className="flex flex-col gap-3 border border-border p-4 transition hover:bg-slate-50 hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30">
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
                  <div className="mt-auto">
                    <Link href={`/catalogue/environments/${t.id}`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <Eye className="h-3 w-3" />
                        View
                      </Button>
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
