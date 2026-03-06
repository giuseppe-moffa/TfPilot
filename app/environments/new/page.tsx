"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Loader2, Search } from "lucide-react"

import { ModuleTag } from "@/components/icons/module-icon"

import { ActionProgressDialog } from "@/components/action-progress-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { validateEnvironmentSlug } from "@/lib/environments/helpers"

import { listEnvironments, listProjects } from "@/config/infra-repos"

function getProjectOptions(): string[] {
  try {
    return listProjects() ?? []
  } catch {
    return []
  }
}

function getEnvKeyOptions(project: string): string[] {
  try {
    return listEnvironments(project) ?? ["dev", "prod"]
  } catch {
    return ["dev", "prod"]
  }
}

type EnvTemplate = {
  id: string
  label?: string
  description?: string
  modules?: { module: string; order: number }[]
}

function NewEnvironmentPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const [templates, setTemplates] = React.useState<EnvTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("")
  const [templateError, setTemplateError] = React.useState<string | null>(null)
  const [templateNotFound, setTemplateNotFound] = React.useState(false)

  const [projectKey, setProjectKey] = React.useState("")
  const [environmentKey, setEnvironmentKey] = React.useState("")
  const [environmentSlug, setEnvironmentSlug] = React.useState("")

  const [submitting, setSubmitting] = React.useState(false)
  const [showProgress, setShowProgress] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const projectOptions = React.useMemo(() => getProjectOptions(), [])
  const envKeyOptions = React.useMemo(() => getEnvKeyOptions(projectKey), [projectKey])
  const useProjectSelect = projectOptions.length > 0

  const blankTemplate: EnvTemplate = {
    id: "blank",
    label: "Blank",
    description: "Start with an empty environment (no predefined modules).",
    modules: [],
  }
  const allTemplates = React.useMemo(() => {
    const hasBlank = templates.some((t) => t.id === "blank")
    return hasBlank ? templates : [blankTemplate, ...templates]
  }, [templates])
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
    fetch("/api/environment-templates")
      .then((res) => {
        if (res.status === 401) {
          setTemplateError("Sign in to create environments")
          return null
        }
        if (res.status === 503) {
          const data = res.json().catch(() => ({}))
          return data.then((d: { error?: string }) => {
            if (d?.error === "ENV_TEMPLATES_NOT_INITIALIZED") {
              setTemplateError("Environment templates are not initialized. Ask an admin to run the seed.")
            } else {
              setTemplateError("Environment templates are not initialized. Ask an admin to run the seed.")
            }
            return []
          })
        }
        if (res.status === 500) {
          setTemplateError("Failed to load templates")
          return []
        }
        if (!res.ok) return []
        return res.json()
      })
      .then((data: EnvTemplate[] | null) => {
        if (cancelled) return
        if (data === null) return
        setTemplates(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setTemplateError("Failed to load templates")
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false)
      })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    const id = searchParams.get("template_id")
    if (!id || loadingTemplates) return
    if (id === "blank") {
      setSelectedTemplateId("blank")
      setStep(2)
      setTemplateNotFound(false)
      return
    }
    if (templates.some((t) => t.id === id)) {
      setSelectedTemplateId(id)
      setStep(2)
      setTemplateNotFound(false)
    } else {
      setTemplateNotFound(true)
    }
  }, [searchParams, templates, loadingTemplates])

  React.useEffect(() => {
    if (projectOptions.length > 0 && !projectKey) {
      setProjectKey(projectOptions[0])
    }
  }, [projectOptions, projectKey])

  React.useEffect(() => {
    if (envKeyOptions.length > 0 && !environmentKey) {
      setEnvironmentKey(envKeyOptions[0])
    }
  }, [envKeyOptions, environmentKey])

  const handleSubmit = async () => {
    const proj = projectKey.trim()
    const envKey = environmentKey.trim().toLowerCase()
    const slug = environmentSlug.trim()
    const slugResult = validateEnvironmentSlug(slug)
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
        environment_key: envKey,
        environment_slug: slug,
      }
      if (selectedTemplateId && selectedTemplateId !== "blank") {
        body.template_id = selectedTemplateId
      }
      const res = await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setSubmitError("Sign in to create environments")
        setShowProgress(false)
        return
      }
      if (res.status === 503 && data?.error === "ENV_TEMPLATES_NOT_INITIALIZED") {
        setSubmitError("Environment templates are not initialized. Ask an admin to run the seed.")
        setShowProgress(false)
        return
      }
      if (res.status === 400 && data?.error === "INVALID_ENV_TEMPLATE") {
        setSubmitError("The selected template is not available (disabled or removed). Please choose another.")
        setShowProgress(false)
        return
      }
      if (res.status === 400) {
        setSubmitError(Array.isArray(data?.errors) ? data.errors.join(", ") : data?.error ?? "Validation failed")
        setShowProgress(false)
        return
      }
      if (res.status === 409 && data?.environment_id) {
        router.push(`/environments/${data.environment_id}`)
        return
      }
      if (!res.ok) {
        setSubmitError(data?.error ?? "Failed to create environment")
        setShowProgress(false)
        return
      }
      const envId = data?.environment?.environment_id
      if (envId) {
        router.push(`/environments/${envId}`)
      } else {
        setSubmitError("Created but no environment_id in response")
        setShowProgress(false)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create environment")
      setShowProgress(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (templateError === "Sign in to create environments") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Sign in to create environments</h1>
        <p className="text-muted-foreground text-center">You need to be signed in to create environments.</p>
        <Link href="/login">
          <Button variant="outline">Sign in</Button>
        </Link>
      </div>
    )
  }

  const selectedTemplate = allTemplates.find((t) => t.id === selectedTemplateId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          {step === 1 && (
            <>
              <div className="text-base font-semibold">New Environment</div>
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
              {templateError && (
                <p className="text-sm text-destructive">{templateError}</p>
              )}
              {templateNotFound && (
                <p className="text-sm text-destructive">Template not found</p>
              )}
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
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
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
              <div className="text-base font-semibold">Environment details</div>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Name *</Label>
                  <Input
                    value={environmentSlug}
                    onChange={(e) => setEnvironmentSlug(e.target.value.toLowerCase())}
                    placeholder="my-app"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase, letters/numbers/hyphens. e.g. my-app
                  </p>
                  {(() => {
                    const slugResult = validateEnvironmentSlug(environmentSlug)
                    const slugInvalid = environmentSlug.trim().length > 0 && !slugResult.ok
                    const slugErr = slugInvalid ? slugResult.error : null
                    const normalizedSlug = environmentSlug.trim().toLowerCase()
                    const rawSuggest =
                      slugErr && (/\s/.test(normalizedSlug) || /_/.test(normalizedSlug))
                        ? normalizedSlug
                            .replace(/\s+/g, "-")
                            .replace(/_+/g, "-")
                            .replace(/-+/g, "-")
                            .replace(/^-+|-+$/g, "") || ""
                        : ""
                    const slugSuggest =
                      rawSuggest && validateEnvironmentSlug(rawSuggest).ok ? rawSuggest : ""
                    return (
                      <>
                        {slugErr ? (
                          <>
                            <p className="text-xs text-destructive" role="alert">
                              {slugErr}
                            </p>
                            {slugSuggest ? (
                              <p className="text-xs text-muted-foreground">Try: {slugSuggest}</p>
                            ) : null}
                          </>
                        ) : environmentSlug.trim().length === 0 ? (
                          <p className="text-xs text-muted-foreground">Enter a name to continue.</p>
                        ) : null}
                      </>
                    )
                  })()}
                </div>
                {useProjectSelect ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Project *</Label>
                    <Select value={projectKey} onValueChange={(v) => { setProjectKey(v); setEnvironmentKey(getEnvKeyOptions(v)[0] ?? ""); }}>
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Infra project for this environment.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Project *</Label>
                    <Input
                      value={projectKey}
                      onChange={(e) => setProjectKey(e.target.value)}
                      placeholder="core"
                    />
                    <p className="text-xs text-muted-foreground">e.g. core, payments</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Environment key *</Label>
                  {useProjectSelect ? (
                    <Select value={environmentKey} onValueChange={setEnvironmentKey}>
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {envKeyOptions.map((e) => (
                          <SelectItem key={e} value={e}>{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={environmentKey} onValueChange={setEnvironmentKey}>
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dev">dev</SelectItem>
                        <SelectItem value="prod">prod</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">dev or prod</p>
                </div>
              </div>
              <div className="mt-auto flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={
                    !projectKey ||
                    !environmentKey ||
                    !environmentSlug.trim() ||
                    !validateEnvironmentSlug(environmentSlug).ok
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
                  <dd>{projectKey}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Environment key</dt>
                  <dd>{environmentKey}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{environmentSlug}</dd>
                </div>
              </dl>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Creating…" : "Create environment"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <ActionProgressDialog
        open={showProgress}
        title="Creating environment…"
        body="Saving environment and opening bootstrap PR."
        steps={[
          { label: "Creating environment", status: "in_progress" },
          { label: "Opening bootstrap PR", status: "pending" },
        ]}
      />
    </div>
  )
}

export default function NewEnvironmentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewEnvironmentPageContent />
    </Suspense>
  )
}
