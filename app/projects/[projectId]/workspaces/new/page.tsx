"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Loader2, Search } from "lucide-react"
import { ModuleTag } from "@/components/icons/module-icon"
import { ActionProgressDialog } from "@/components/action-progress-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { validateWorkspaceSlug } from "@/lib/workspaces/helpers"

const DEFAULT_WORKSPACE_KEYS = ["dev", "prod"]

function getWorkspaceKeyOptions(_project: string): string[] {
  return DEFAULT_WORKSPACE_KEYS
}

type WorkspaceTemplate = {
  id: string
  label?: string
  name?: string
  description?: string
  latest_version?: string
  modules?: { module: string; order: number }[]
}

function NewWorkspacePageContent() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params?.projectId as string | undefined

  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const [templates, setTemplates] = React.useState<WorkspaceTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("")
  const [templateError, setTemplateError] = React.useState<string | null>(null)
  const [templateNotFound, setTemplateNotFound] = React.useState(false)

  const [workspaceKey, setWorkspaceKey] = React.useState("")
  const [workspaceSlug, setWorkspaceSlug] = React.useState("")

  const [submitting, setSubmitting] = React.useState(false)
  const [showProgress, setShowProgress] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [projectName, setProjectName] = React.useState<string | null>(null)

  const wsKeyOptions = React.useMemo(
    () => getWorkspaceKeyOptions(projectId ?? ""),
    [projectId]
  )

  const allTemplates = React.useMemo(() => templates, [templates])
  const filteredTemplates = React.useMemo(() => {
    const q = templateSearchQuery.trim().toLowerCase()
    if (!q) return allTemplates
    return allTemplates.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.label ?? "").toLowerCase().includes(q)
    )
  }, [allTemplates, templateSearchQuery])

  React.useEffect(() => {
    let cancelled = false
    setLoadingTemplates(true)
    setTemplateError(null)
    setTemplateNotFound(false)
    fetch("/api/workspace-templates")
      .then((res) => {
        if (res.status === 401) {
          setTemplateError("Sign in to create workspaces")
          return null
        }
        if (res.status === 503) {
          setTemplateError("Workspace templates are not initialized. Ask an admin to run the seed.")
          return []
        }
        if (!res.ok) return []
        return res.json()
      })
      .then((data: WorkspaceTemplate[] | null) => {
        if (cancelled || data === null) return
        setTemplates(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setTemplateError("Failed to load templates")
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!projectId?.trim()) return
    let cancelled = false
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { project?: { name?: string } } | null) => {
        if (cancelled || !data?.project) return
        setProjectName(data.project.name ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

  React.useEffect(() => {
    const id = searchParams.get("template_id")
    if (!id || loadingTemplates) return
    if (templates.some((t) => t.id === id)) {
      setSelectedTemplateId(id)
      setStep(2)
    } else {
      setTemplateNotFound(true)
    }
  }, [searchParams, templates, loadingTemplates])

  React.useEffect(() => {
    if (wsKeyOptions.length > 0 && !workspaceKey) {
      setWorkspaceKey(wsKeyOptions[0]!)
    }
  }, [wsKeyOptions, workspaceKey])

  const handleSubmit = async () => {
    const proj = (projectId ?? "").trim()
    const wsKey = workspaceKey.trim().toLowerCase()
    const slug = workspaceSlug.trim()
    const slugResult = validateWorkspaceSlug(slug)
    if (!slugResult.ok) {
      setSubmitError(slugResult.error)
      return
    }
    setSubmitError(null)
    setShowProgress(true)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        project_key: proj,
        workspace_key: wsKey,
        workspace_slug: slug,
        template_id: selectedTemplateId ?? "",
        template_inputs: {},
      }
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setSubmitError("Sign in to create workspaces")
        setShowProgress(false)
        return
      }
      if (res.status === 503 && data?.error === "WORKSPACE_TEMPLATES_NOT_INITIALIZED") {
        setSubmitError("Workspace templates are not initialized. Ask an admin to run the seed.")
        setShowProgress(false)
        return
      }
      if (res.status === 400 && data?.error === "INVALID_WORKSPACE_TEMPLATE") {
        setSubmitError("The selected template is not available (disabled or removed). Please choose another.")
        setShowProgress(false)
        return
      }
      if (res.status === 400) {
        setSubmitError(
          Array.isArray(data?.errors) ? data.errors.join(", ") : data?.error ?? "Validation failed"
        )
        setShowProgress(false)
        return
      }
      if (res.status === 409 && data?.workspace_id) {
        router.push(`/projects/${proj}/workspaces/${data.workspace_id}`)
        return
      }
      if (!res.ok) {
        setSubmitError(data?.error ?? "Failed to create workspace")
        setShowProgress(false)
        return
      }
      const wsId = data?.workspace?.workspace_id
      if (wsId) {
        router.push(`/projects/${proj}/workspaces/${wsId}`)
      } else {
        setSubmitError("Created but no workspace_id in response")
        setShowProgress(false)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create workspace")
      setShowProgress(false)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedTemplate = allTemplates.find((t) => t.id === selectedTemplateId)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          Projects
        </Link>
        <span>/</span>
        <Link
          href={`/projects/${projectId}`}
          className="hover:text-foreground transition-colors"
        >
          {projectName ?? projectId}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">New Workspace</span>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          {step === 1 && (
            <>
              <div className="text-base font-semibold">New Workspace — Select template</div>
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search templates…"
                  value={templateSearchQuery}
                  onChange={(e) => setTemplateSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {templateError && <p className="text-sm text-destructive">{templateError}</p>}
              {templateNotFound && <p className="text-sm text-destructive">Template not found</p>}
              {loadingTemplates ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading templates…
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No templates match your search
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={loadingTemplates}
                      onClick={() => {
                        setSelectedTemplateId(t.id)
                        setTemplateNotFound(false)
                        setStep(2)
                      }}
                      className="border border-border bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30"
                    >
                      <div className="font-semibold text-foreground">{t.label ?? t.id}</div>
                      {t.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {t.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(t.modules?.length ?? 0) === 0 ? (
                          <span className="inline-block bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            No modules
                          </span>
                        ) : (
                          (t.modules ?? [])
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
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-base font-semibold">Workspace details</div>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Name *</Label>
                  <Input
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase())}
                    placeholder="my-service"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase, letters/numbers/hyphens. e.g. my-service
                  </p>
                  {(() => {
                    const result = validateWorkspaceSlug(workspaceSlug)
                    const invalid = workspaceSlug.trim().length > 0 && !result.ok
                    const err = invalid ? result.error : null
                    return err ? (
                      <p className="text-xs text-destructive" role="alert">
                        {err}
                      </p>
                    ) : workspaceSlug.trim().length === 0 ? (
                      <p className="text-xs text-muted-foreground">Enter a name to continue.</p>
                    ) : null
                  })()}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Project</Label>
                  <Input value={projectName ?? projectId ?? ""} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground">Inherited from project context.</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Environment *</Label>
                  <Select value={workspaceKey} onValueChange={setWorkspaceKey}>
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {wsKeyOptions.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select environment (e.g. dev, prod)</p>
                </div>
              </div>
              <div className="mt-auto flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={
                    !workspaceKey ||
                    !workspaceSlug.trim() ||
                    !validateWorkspaceSlug(workspaceSlug).ok
                  }
                >
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="text-base font-semibold">Review</div>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Template</dt>
                  <dd>{selectedTemplate?.label ?? selectedTemplateId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Project</dt>
                  <dd>{projectName ?? projectId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Environment</dt>
                  <dd>{workspaceKey}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{workspaceSlug}</dd>
                </div>
              </dl>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Creating…" : "Create workspace"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <ActionProgressDialog
        open={showProgress}
        title="Creating workspace…"
        body="Saving workspace and opening bootstrap PR."
        steps={[
          { label: "Creating workspace", status: "in_progress" },
          { label: "Opening bootstrap PR", status: "pending" },
        ]}
      />
    </div>
  )
}

export default function NewWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewWorkspacePageContent />
    </Suspense>
  )
}
