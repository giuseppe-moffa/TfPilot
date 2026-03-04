"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { ArrowLeft, Loader2, Search } from "lucide-react"

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

const FieldCard = ({
  label,
  description,
  required,
  fullWidth,
  children,
}: {
  label: string
  description?: string
  required?: boolean
  fullWidth?: boolean
  children: React.ReactNode
}) => (
  <div className={`rounded-lg bg-muted/50 dark:bg-muted/40 px-3 py-3 transition focus-within:ring-2 focus-within:ring-primary/20 focus-within:ring-offset-0 ${fullWidth ? "sm:col-span-2" : ""}`}>
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <Label className="text-sm font-semibold text-foreground">
          {label}
          {required ? " *" : ""}
        </Label>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  </div>
)

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
  const [slugError, setSlugError] = React.useState<string | null>(null)

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
  const allTemplates = React.useMemo(() => [blankTemplate, ...templates], [templates])
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
      setSlugError(slugResult.error)
      return
    }
    setSlugError(null)
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
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
      <header className="flex items-center justify-between gap-3 bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/environments">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">New Environment</h1>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-4xl space-y-6">
          {step === 1 && (
            <Card className="rounded-lg border-0 bg-card p-6 shadow-sm space-y-4">
              <div className="text-base font-semibold">Choose a template</div>
              <div className="relative">
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
                      className={`rounded-lg border px-4 py-3 text-left transition hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30 ${
                        selectedTemplateId === t.id
                          ? "border-primary bg-primary/10 ring-1 ring-primary/20 shadow-sm"
                          : "border-border bg-background hover:bg-muted/30"
                      }`}
                    >
                      <div className="font-semibold text-foreground">{t.label ?? t.id}</div>
                      {t.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                      )}
                      {t.id === "blank" && (
                        <span className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          No modules
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}

          {step === 2 && (
            <Card className="rounded-lg border-0 bg-card p-6 shadow-sm space-y-4">
              <div className="text-base font-semibold">Environment details</div>
              <div className="flex flex-col gap-2 pb-4">
                <Button variant="secondary" size="sm" onClick={() => setStep(1)} className="w-fit">
                  Back
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {useProjectSelect ? (
                  <FieldCard label="Project" required description="Infra project for this environment.">
                    <Select value={projectKey} onValueChange={(v) => { setProjectKey(v); setEnvironmentKey(getEnvKeyOptions(v)[0] ?? ""); }}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldCard>
                ) : (
                  <FieldCard label="Project" required description="e.g. core, payments">
                    <Input
                      value={projectKey}
                      onChange={(e) => setProjectKey(e.target.value)}
                      placeholder="core"
                    />
                  </FieldCard>
                )}
                <FieldCard label="Environment key" required description="dev or prod">
                  {useProjectSelect ? (
                    <Select value={environmentKey} onValueChange={setEnvironmentKey}>
                      <SelectTrigger className="w-full">
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
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dev">dev</SelectItem>
                        <SelectItem value="prod">prod</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </FieldCard>
                <FieldCard
                  label="Environment slug"
                  required
                  description="Lowercase, letters/numbers/hyphens. e.g. my-app"
                  fullWidth
                >
                  <div className="space-y-1">
                    <Input
                      value={environmentSlug}
                      onChange={(e) => {
                        setEnvironmentSlug(e.target.value.toLowerCase())
                        setSlugError(null)
                      }}
                      placeholder="my-app"
                    />
                    {slugError && <p className="text-xs text-destructive">{slugError}</p>}
                  </div>
                </FieldCard>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>
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
            </Card>
          )}

          {step === 3 && (
            <Card className="rounded-lg border-0 bg-card p-6 shadow-sm space-y-4">
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
                  <dt className="text-muted-foreground">Environment slug</dt>
                  <dd>{environmentSlug}</dd>
                </div>
              </dl>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Creating…" : "Create environment"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

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
