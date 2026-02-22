"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Info, Loader2, Search, Sparkles } from "lucide-react"

import { ActionProgressDialog } from "@/components/action-progress-dialog"

import { AssistantHelper } from "@/components/assistant-helper"
import { AssistantDrawer } from "@/components/assistant-drawer"
import { SuggestionPanel } from "@/components/suggestion-panel"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { listEnvironments, listProjects } from "@/config/infra-repos"
import { getRequestTemplate, type RequestTemplate } from "@/config/request-templates"

/** Client-safe 6-char suffix for generatedName (name + shortId). Lowercase for AWS-friendly names. */
function randomShortId(): string {
  const alphabet = "abcdefghjklmnpqrstuvwxyz23456789"
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
  }
  return Math.random().toString(36).slice(2, 8).toLowerCase().replace(/[^a-z0-9]/g, "a").slice(0, 6)
}

/** Primary identifier form key by module (used for generatedName prefill). */
function primaryIdKeyForModule(moduleKey: string): string {
  switch (moduleKey) {
    case "ec2-instance":
      return "name"
    case "s3-bucket":
      return "bucket_name"
    case "ecr-repo":
      return "repo_name"
    default:
      return "name"
  }
}

type FieldMeta = {
  name: string
  type: "string" | "number" | "boolean" | "map" | "list" | "enum"
  required?: boolean
  default?: unknown
  description?: string
  enum?: string[]
  immutable?: boolean
  readOnly?: boolean
  sensitive?: boolean
  risk_level?: "low" | "medium" | "high"
  category?: string
}

type ModuleSchema = {
  type: string
  category: string
  description: string
  fields: FieldMeta[]
}

const formatLabel = (raw: string) => {
  const acronyms = new Set(["id", "arn", "kms", "sse", "s3"])
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase()
      if (acronyms.has(lower)) return lower.toUpperCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

const FieldCard = ({
  id,
  label,
  description,
  required,
  children,
  alignEnd = false,
  fullWidth = false,
}: {
  id?: string
  label: string
  description?: string
  required?: boolean
  children: React.ReactNode
  alignEnd?: boolean
  fullWidth?: boolean
}) => (
  <div
    id={id}
    className={`rounded-lg bg-muted/50 dark:bg-muted/40 px-3 py-3 transition focus-within:ring-2 focus-within:ring-primary/20 focus-within:ring-offset-0 ${
      fullWidth ? 'md:col-span-2' : ''
    }`}
  >
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <Label className="text-sm font-semibold text-foreground">
          {label}
          {required ? " *" : ""}
        </Label>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className={alignEnd ? "flex-shrink-0" : "flex-1"}>{children}</div>
    </div>
  </div>
)

export default function NewRequestPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [project, setProject] = React.useState("")
  const [environment, setEnvironment] = React.useState("")
  const [moduleName, setModuleName] = React.useState("")
  const [modules, setModules] = React.useState<ModuleSchema[]>([])
  const [loadingModules, setLoadingModules] = React.useState(false)
  const [loadingSubmit, setLoadingSubmit] = React.useState(false)
  const [showCreateDialog, setShowCreateDialog] = React.useState(false)
  const createDialogTimerRef = React.useRef<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [formValues, setFormValues] = React.useState<Record<string, any>>({})
  const [assistantState, setAssistantState] = React.useState<any>(null)
  const projects = listProjects()
  const environments = project ? listEnvironments(project) : []
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const drawerWidth = 520
  const [activeField, setActiveField] = React.useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const hasAppliedTemplateFromQuery = React.useRef(false)

  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("")
  const [envStep, setEnvStep] = React.useState<1 | 2 | 3>(1)
  const [environmentName, setEnvironmentName] = React.useState("")
  const [generatedName, setGeneratedName] = React.useState("")
  const [envSelectedProject, setEnvSelectedProject] = React.useState("")

  const [requestTemplates, setRequestTemplates] = React.useState<(RequestTemplate & { project?: string })[]>(() => [
    {
      id: "blank",
      label: "Blank template",
      description: "Start from scratch",
      moduleKey: "",
      environment: "",
      allowCustomProjectEnv: true,
      defaultConfig: {},
    },
  ])
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoadingTemplates(true)
    fetch("/api/templates")
      .then((res) => (res.ok ? res.json() : []))
      .then((apiList: Array<{ id: string; label: string; description?: string; project?: string; environment: string; module: string; defaultConfig: Record<string, unknown>; lockEnvironment?: boolean; allowCustomProjectEnv?: boolean }>) => {
        if (cancelled) return
        const mapped = (apiList ?? []).map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description,
          moduleKey: t.module,
          environment: t.environment,
          lockEnvironment: t.lockEnvironment ?? false,
          allowCustomProjectEnv: t.allowCustomProjectEnv ?? false,
          defaultConfig: t.defaultConfig ?? {},
          project: t.project,
        }))
        setRequestTemplates((prev) => [prev[0], ...mapped])
      })
      .catch(() => { if (!cancelled) setRequestTemplates((prev) => prev) })
      .finally(() => { if (!cancelled) setLoadingTemplates(false) })
    return () => { cancelled = true }
  }, [])

  const envProjectOptions = React.useMemo(() => listProjects(), [])
  React.useEffect(() => {
    if (envProjectOptions.length === 0) return
    const last = typeof window !== "undefined" ? localStorage.getItem("tfpilot-last-env-project") : null
    setEnvSelectedProject((prev) => {
      if (prev && envProjectOptions.includes(prev)) return prev
      if (last && envProjectOptions.includes(last)) return last
      return envProjectOptions[0] ?? ""
    })
  }, [envProjectOptions])

  const setEnvSelectedProjectAndPersist = React.useCallback((project: string) => {
    setEnvSelectedProject(project)
    if (typeof window !== "undefined") localStorage.setItem("tfpilot-last-env-project", project)
  }, [])

  // When opening from catalogue "Create request" with ?templateId=, jump to step 2 with template selected
  React.useEffect(() => {
    const templateId = searchParams.get("templateId")
    if (!templateId || loadingTemplates || hasAppliedTemplateFromQuery.current) return
    const t = getRequestTemplate(requestTemplates, templateId)
    if (!t) return
    hasAppliedTemplateFromQuery.current = true
    setSelectedTemplateId(t.id)
    const templateProject = "project" in t ? String((t as { project?: string }).project ?? "").trim() : ""
    const projectOverride = templateProject ? templateProject : envSelectedProject
    if (templateProject) setEnvSelectedProjectAndPersist(templateProject)
    setProject(projectOverride)
    setModuleName(t.moduleKey ?? "")
    const showProjectSelector = t.allowCustomProjectEnv === true || !templateProject
    if (showProjectSelector) {
      setEnvironment(listEnvironments(projectOverride)[0] ?? "")
      setFormValues({})
    } else {
      setEnvironment(t.environment)
    }
    setEnvStep(2)
    router.replace("/requests/new", { scroll: false })
  }, [searchParams, loadingTemplates, requestTemplates, envSelectedProject, setEnvSelectedProjectAndPersist, router])

  const filteredEnvTemplates = React.useMemo(() => {
    const q = templateSearchQuery.trim().toLowerCase()
    if (!q) return requestTemplates
    return requestTemplates.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.moduleKey.toLowerCase().includes(q) ||
        t.environment.toLowerCase().includes(q)
    )
  }, [requestTemplates, templateSearchQuery])

  React.useEffect(() => {
    return () => {
      if (createDialogTimerRef.current) clearTimeout(createDialogTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    const loadModules = async () => {
      setLoadingModules(true)
      try {
        const res = await fetch("/api/modules/schema", { cache: "no-store" })
        const data = await res.json()
        if (!data?.success || data.schemaVersion !== 2 || !data.modules) {
          throw new Error("Schema contract v2 required")
        }
        const names = data.modules as ModuleSchema[]
        setModules(names)
      } catch (err) {
        setError((err as Error)?.message ?? "Failed to load module schema")
      } finally {
        setLoadingModules(false)
      }
    }
    void loadModules()
  }, [])

  const selectedModule = React.useMemo(() => modules.find((m) => m.type === moduleName), [modules, moduleName])

  // Tags are server-authoritative: hide from config UI so they are never user-configurable.
  const fieldsCore = React.useMemo(
    () =>
      (selectedModule?.fields ?? []).filter(
        (f) => f.name !== "tags" && (f.category ?? "core") === "core" && !f.readOnly
      ),
    [selectedModule?.fields]
  )
  const fieldsAdvanced = React.useMemo(
    () =>
      (selectedModule?.fields ?? []).filter(
        (f) => f.name !== "tags" && (f.category ?? "core") !== "core" && !f.readOnly
      ),
    [selectedModule?.fields]
  )

  const setDefaults = React.useCallback(
    (mod?: ModuleSchema) => {
      if (!mod) return
      const next: Record<string, any> = {}
      for (const f of mod.fields) {
        if (f.name === "tags" || f.readOnly || f.immutable) continue
        if (f.default !== undefined) {
          next[f.name] = f.default
        }
      }
      setFormValues(next)
    },
    [setFormValues]
  )

  const applyTemplate = React.useCallback(
    (t: RequestTemplate & { project?: string }, projectOverride: string) => {
      const mod = modules.find((m) => m.type === t.moduleKey)
      const base: Record<string, any> = {}
      if (mod) {
        for (const f of mod.fields) {
          if (f.readOnly || f.immutable) continue
          if (f.default !== undefined) base[f.name] = f.default
        }
      }
      setFormValues({ ...base, ...t.defaultConfig } as Record<string, any>)
      setProject(projectOverride)
      setEnvironment(t.environment)
      setModuleName(t.moduleKey)
      setSelectedTemplateId(t.id)
    },
    [modules]
  )

  const handleFieldChange = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }

  const prevActiveFieldRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    // Only focus if activeField actually changed (not on every render)
    if (!activeField || activeField === prevActiveFieldRef.current) return
    prevActiveFieldRef.current = activeField
    
    // Use setTimeout to avoid interfering with current focus
    const timeoutId = setTimeout(() => {
      const el = document.getElementById(`field-${activeField}`)
      const input = el?.querySelector('input, textarea') as HTMLElement
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true })
      }
    }, 0)
    
    return () => clearTimeout(timeoutId)
  }, [activeField])

  function toConfigValue(field: FieldMeta, val: any) {
    if (val === "" || val === undefined || val === null) return undefined
    switch (field.type) {
      case "boolean":
        return Boolean(val)
      case "number": {
        const n = Number(val)
        return Number.isNaN(n) ? undefined : n
      }
      case "list": {
        if (Array.isArray(val)) return val
        const text = String(val)
        if (!text.trim()) return undefined
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed)) return parsed
        } catch {
          /* ignore */
        }
        return text.split(",").map((v) => v.trim()).filter(Boolean)
      }
      case "map": {
        if (val && typeof val === "object" && !Array.isArray(val)) return val
        const text = String(val)
        if (!text.trim()) return undefined
        try {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
        } catch {
          /* ignore */
        }
        const out: Record<string, string> = {}
        for (const line of text.split("\n")) {
          const [k, ...rest] = line.split("=")
          if (!k || rest.length === 0) continue
          out[k.trim()] = rest.join("=").trim()
        }
        return out
      }
      default:
        return val
    }
  }

  const buildConfig = React.useCallback(() => {
    if (!selectedModule) return {}
    const cfg: Record<string, unknown> = {}
    const fieldMap = new Map(selectedModule.fields.map(f => [f.name, f]))
    
    // Step 1: Include all fields that have non-empty values
    // Note: immutable fields should be included (they can be set initially), only readOnly fields are skipped
    for (const field of selectedModule.fields) {
      if (field.readOnly) continue
      const raw = formValues[field.name] ?? field.default
      const parsed = toConfigValue(field, raw)
      if (parsed !== undefined) {
        cfg[field.name] = parsed
      }
    }
    
    // Step 2: Explicitly ensure all required fields are included (even if empty)
    // This guarantees required fields are always in the config
    // Note: readOnly fields that are required should still be included (they may be auto-generated)
    for (const field of selectedModule.fields) {
      if (field.required && !(field.name in cfg)) {
        // For 'name' field, try to derive from common name fields if not provided
        if (field.name === 'name' && !(field.name in formValues)) {
          // Try common name fields: bucket_name, queue_name, service_name
          const nameFields = ['bucket_name', 'queue_name', 'service_name']
          let derivedName: string | undefined
          for (const nameField of nameFields) {
            const value = formValues[nameField]
            if (value && typeof value === 'string' && value.trim()) {
              derivedName = value.trim()
              break
            }
          }
          cfg[field.name] = derivedName ?? field.default ?? ""
        } else {
          // Use value from formValues if it exists, otherwise use default or empty string
          const raw = formValues[field.name] ?? field.default ?? ""
          // For required fields, include the raw value even if toConfigValue returns undefined
          // The backend will validate and provide proper error messages
          cfg[field.name] = raw
        }
      }
    }
    
    // Step 3: Include any other formValues that are in the schema but not yet in config
    for (const [key, value] of Object.entries(formValues)) {
      if (key in cfg) continue // Already included
      const field = fieldMap.get(key)
      if (!field || field.readOnly) continue
      // Field exists in schema, include it
      const parsed = toConfigValue(field, value)
      if (parsed !== undefined) {
        cfg[key] = parsed
      } else if (value !== undefined && value !== null && value !== "") {
        // Include non-empty values even if toConfigValue returned undefined
        cfg[key] = value
      }
    }
    
    return cfg
  }, [formValues, selectedModule])

  const handleSubmit = async () => {
    setError(null)
    if (!project || !environment || !moduleName) {
      setError("Project, environment, and module are required.")
      return
    }
    
    // Validate that 'name' will be available in the config
    const cfg = buildConfig()
    const nameValue = cfg.name
    if (!nameValue || typeof nameValue !== 'string' || !nameValue.trim()) {
      setError("Name is required.")
      return
    }
    
    // Validate AWS resource name format: lowercase alphanumeric and hyphens only, max 63 chars
    const trimmedName = nameValue.trim()
    const awsNameRegex = /^[a-z0-9-]+$/
    if (!awsNameRegex.test(trimmedName)) {
      setError("Name must contain only lowercase letters, numbers, and hyphens (no spaces or uppercase letters).")
      return
    }
    if (trimmedName.length > 63) {
      setError("Name must be 63 characters or less.")
      return
    }
    
    setLoadingSubmit(true)
    setShowCreateDialog(false)
    createDialogTimerRef.current = window.setTimeout(() => setShowCreateDialog(true), 400)
    try {
      const payload: Record<string, unknown> = {
        project,
        environment,
        module: moduleName,
        config: cfg,
      }
      payload.templateId = selectedTemplateId ?? undefined
      payload.environmentName = environmentName.trim() || undefined
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create request")
      }
      if (data?.requestId) {
        window.location.href = `/requests/${data.requestId}`
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create request")
    } finally {
      if (createDialogTimerRef.current) {
        clearTimeout(createDialogTimerRef.current)
        createDialogTimerRef.current = null
      }
      setShowCreateDialog(false)
      setLoadingSubmit(false)
    }
  }

  const configObject = React.useMemo(() => buildConfig(), [buildConfig])

  const renderField = (field: FieldMeta, fullWidth = false) => {
    const value = formValues[field.name] ?? field.default ?? ""
    const description = field.description ?? ""

    const fieldId = `field-${field.name}`

    // Name from Step 2 (generatedName = logical name + shortId) is read-only in Step 3
    const primaryKey = selectedModule ? primaryIdKeyForModule(selectedModule.type) : ""
    const isNameFromStep2 = Boolean(generatedName && field.name === primaryKey)

    switch (field.type) {
      case "boolean":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            alignEnd
          >
            <Switch
              checked={Boolean(value)}
              onFocus={() => setActiveField(field.name)}
              onCheckedChange={(checked: boolean) => handleFieldChange(field.name, checked)}
            />
          </FieldCard>
        )
      case "enum":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            fullWidth={fullWidth}
          >
            <Select value={String(value ?? "")} onValueChange={(v) => handleFieldChange(field.name, v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                {(field.enum ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldCard>
        )
      case "map":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            fullWidth={fullWidth}
          >
            <Textarea
              key={`textarea-${field.name}`}
              value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}
              className="mt-1 min-h-[120px]"
              onFocus={() => setActiveField(field.name)}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange(field.name, e.target.value)}
              placeholder="key=value per line or JSON"
            />
          </FieldCard>
        )
      case "list":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            fullWidth={fullWidth}
          >
            <Textarea
              key={`textarea-list-${field.name}`}
              value={Array.isArray(value) ? value.join(",") : String(value ?? "")}
              className="mt-1 min-h-[120px]"
              onFocus={() => setActiveField(field.name)}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange(field.name, e.target.value)}
              placeholder="Comma separated or JSON array"
            />
          </FieldCard>
        )
      case "number":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            fullWidth={fullWidth}
          >
            <Input
              key={`input-number-${field.name}`}
              type="number"
              className="mt-1"
              value={String(value ?? "")}
              onFocus={() => setActiveField(field.name)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="Enter number"
            />
          </FieldCard>
        )
      default:
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={formatLabel(field.name)}
            description={description}
            required={field.required}
            fullWidth={fullWidth}
          >
            <Input
              key={`input-${field.name}`}
              className={isNameFromStep2 ? "mt-1 bg-muted" : "mt-1"}
              value={String(value ?? "")}
              readOnly={isNameFromStep2}
              disabled={isNameFromStep2}
              onFocus={() => setActiveField(field.name)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder="Enter value"
            />
          </FieldCard>
        )
    }
  }

  const summaryItems = React.useMemo(() => {
    const items: { label: string; value: any }[] = []
    if (selectedModule) {
      for (const f of selectedModule.fields) {
        if (f.readOnly || f.immutable) continue
        if (configObject[f.name] === undefined) continue
        items.push({ label: f.name, value: configObject[f.name] })
      }
    }
    return items
  }, [selectedModule, configObject])

  return (
    <div
      className="flex h-[calc(100vh-4rem)] flex-col bg-background text-foreground transition-[margin-right]"
      style={{ marginRight: assistantOpen ? drawerWidth : 0 }}
    >
      <header className="flex items-center justify-between gap-3 bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/requests">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">New Request</h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={envStep !== 3}
          onClick={() => setAssistantOpen(true)}
        >
          <Sparkles className="mr-2 h-4 w-4" /> Assistant
        </Button>
      </header>

      <div className="flex-1 p-4 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-6">
          {envStep === 1 ? (
              <Card className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-4">
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
                {loadingTemplates ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading templates…
                  </div>
                ) : filteredEnvTemplates.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No templates match your search
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredEnvTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={loadingTemplates}
                        onClick={() => {
                          setSelectedTemplateId(t.id)
                          const templateProject = "project" in t ? String((t as { project?: string }).project ?? "").trim() : ""
                          const projectOverride = templateProject ? templateProject : envSelectedProject
                          if (templateProject) {
                            setEnvSelectedProjectAndPersist(templateProject)
                          }
                          setProject(projectOverride)
                          setModuleName(t.moduleKey ?? "")
                          const showProjectSelector = t.allowCustomProjectEnv === true || !templateProject
                          if (showProjectSelector) {
                            setEnvironment(listEnvironments(projectOverride)[0] ?? "")
                            setFormValues({})
                          } else {
                            setEnvironment(t.environment)
                          }
                          setEnvStep(2)
                        }}
                        className={`rounded-lg border px-4 py-3 text-left transition hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30 ${
                          selectedTemplateId === t.id
                            ? "border-primary bg-primary/10 ring-1 ring-primary/20 shadow-sm"
                            : "border-border bg-background hover:bg-muted/30"
                        }`}
                      >
                        <div className="font-semibold text-foreground">{t.label}</div>
                        {t.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.id === "blank" || !t.environment ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Custom
                            </span>
                          ) : (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {t.environment === "prod" ? "Prod" : "Dev"}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            ) : envStep === 2 ? (
              <Card className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-4">
                <div className="text-base font-semibold">Environment details</div>
                {(() => {
                  const t = selectedTemplateId ? getRequestTemplate(requestTemplates, selectedTemplateId) : null
                  if (!t) {
                    return (
                      <div className="flex flex-col gap-2 py-4">
                        <p className="text-sm text-muted-foreground">No template selected.</p>
                        <Button variant="secondary" onClick={() => setEnvStep(1)}>
                          Back
                        </Button>
                      </div>
                    )
                  }
                  const templateProject = "project" in t ? String((t as { project?: string }).project ?? "").trim() : ""
                  const showProjectSelector = t.allowCustomProjectEnv === true || !templateProject
                  const nameValid = environmentName.trim().length > 0
                  return (
                    <>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Name *</Label>
                        <Input
                          value={environmentName}
                          onChange={(e) => setEnvironmentName(e.target.value)}
                          placeholder="e.g. my-app"
                          className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground">
                          Logical name for this resource. A unique suffix is automatically appended.
                        </p>
                        {!nameValid && environmentName.length > 0 && (
                          <p className="text-xs text-destructive">Name is required.</p>
                        )}
                        {environmentName.length === 0 && (
                          <p className="text-xs text-muted-foreground">Enter a name to continue.</p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {showProjectSelector ? (
                          <>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Project</Label>
                              <Select
                                value={project}
                                onValueChange={(v) => {
                                  setProject(v)
                                  setEnvironment(listEnvironments(v)[0] ?? "")
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select project" />
                                </SelectTrigger>
                                <SelectContent>
                                  {envProjectOptions.map((p) => (
                                    <SelectItem key={p} value={p}>
                                      {p}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Environment</Label>
                              <Select value={environment} onValueChange={setEnvironment}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select environment" />
                                </SelectTrigger>
                                <SelectContent>
                                  {listEnvironments(project).map((env) => (
                                    <SelectItem key={env} value={env}>
                                      {env}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {t.moduleKey ? (
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Module</Label>
                                <Input value={t.moduleKey} readOnly disabled className="bg-muted" />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Module</Label>
                                <Select
                                  value={moduleName}
                                  onValueChange={(v) => {
                                    setModuleName(v)
                                    const mod = modules.find((m) => m.type === v)
                                    const base: Record<string, unknown> = {}
                                    if (mod) {
                                      for (const f of mod.fields) {
                                        if (f.name === "tags" || f.readOnly || f.immutable) continue
                                        if (f.default !== undefined) base[f.name] = f.default
                                      }
                                    }
                                    setFormValues(base)
                                  }}
                                  disabled={loadingModules}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder={loadingModules ? "Loading..." : "Select module"} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {modules.map((m) => (
                                      <SelectItem key={m.type} value={m.type}>
                                        {m.type}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Project</Label>
                              <Select
                                value={project}
                                onValueChange={(v) => {
                                  setProject(v)
                                  setEnvSelectedProjectAndPersist(v)
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select project" />
                                </SelectTrigger>
                                <SelectContent>
                                  {envProjectOptions.map((p) => (
                                    <SelectItem key={p} value={p}>
                                      {p}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Environment</Label>
                              <Input value={t.environment} readOnly disabled className="bg-muted" />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setEnvStep(1)
                            setGeneratedName("")
                          }}
                        >
                          Back
                        </Button>
                        <Button
                        type="button"
                        disabled={
                            environmentName.trim().length === 0 ||
                            !project ||
                            (showProjectSelector ? !environment || (!t.moduleKey && !moduleName) : false)
                          }
                          onClick={() => {
                            setEnvStep(3)
                            if (t) {
                              const trimmedName = environmentName.trim()
                              const shortId = randomShortId()
                              const genName = `${trimmedName}-${shortId}`
                              setGeneratedName(genName)
                              const effectiveModule = showProjectSelector ? moduleName : t.moduleKey
                              if (!showProjectSelector) setModuleName(t.moduleKey)
                              const mod = modules.find((m) => m.type === effectiveModule)
                              const base: Record<string, unknown> = {}
                              if (mod) {
                                for (const f of mod.fields) {
                                  if (f.name === "tags" || f.readOnly || f.immutable) continue
                                  if (f.default !== undefined) base[f.name] = f.default
                                }
                              }
                              const templateConfig = (t.defaultConfig || {}) as Record<string, unknown>
                              const primaryKey = primaryIdKeyForModule(effectiveModule)
                              setFormValues({
                                ...base,
                                ...templateConfig,
                                name: genName,
                                [primaryKey]: genName,
                              } as Record<string, unknown>)
                            }
                          }}
                        >
                          Continue
                        </Button>
                      </div>
                    </>
                  )
                })()}
              </Card>
            ) : (
            <>
              {selectedTemplateId && (() => {
                const t = getRequestTemplate(requestTemplates, selectedTemplateId)
                if (!t) return null
                return (
                  <Card className="rounded-xl border-0 bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{t.label}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{generatedName || environmentName.trim() || "—"}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {project}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.environment || "—"}
                      </span>
                    </div>
                  </Card>
                )
              })()}
              <Card className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Project</Label>
                    <Input value={project} readOnly disabled className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Environment</Label>
                    <Input value={environment} readOnly disabled className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Module</Label>
                    <Input value={moduleName || "—"} readOnly disabled className="bg-muted" />
                  </div>
                </div>
                {loadingModules && (
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading modules...
                  </div>
                )}
              </Card>
              <Card className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-4">
                <div className="text-base font-semibold">Configuration</div>
                {!selectedModule && (
                  <div className="text-sm text-muted-foreground">Select a module to view its inputs.</div>
                )}
                {selectedModule && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 rounded-lg bg-muted/30 dark:bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <Info className="h-4 w-4" />
                      Fill required fields; optional fields may be left empty. Values are sent to the server for validation.
                    </div>
                    <div className="space-y-3">
                      <div className="text-sm font-semibold">Core settings</div>
                      <div className="space-y-3">
                        {fieldsCore.map((f) => renderField(f, false))}
                      </div>
                    </div>
                    {fieldsAdvanced.length > 0 && (
                      <details className="rounded-lg bg-muted/30 dark:bg-muted/40 p-3" open={false}>
                        <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
                        <div className="mt-3 space-y-3">
                          {fieldsAdvanced.map((f) => renderField(f))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </Card>
              <Card className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-3">
                <div className="text-base font-semibold">Configuration Summary</div>
                <div className="space-y-2 text-sm">
                  {summaryItems.length === 0 && (
                    <div className="text-muted-foreground">No fields set.</div>
                  )}
                  {summaryItems.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg bg-muted/30 dark:bg-muted/40 px-3 py-2"
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {JSON.stringify(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
                {error && <div className="text-xs text-destructive">{error}</div>}
                <div className="flex justify-end pt-2">
                  <Button
                    disabled={loadingSubmit || !project || !environment || !moduleName}
                    onClick={handleSubmit}
                  >
                    {loadingSubmit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {loadingSubmit ? "Creating..." : "Create Request"}
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>

        <ActionProgressDialog
          open={showCreateDialog}
          title="Creating request…"
          body="Generating Terraform configuration and opening pull request."
          steps={[
            { label: "Saving configuration", status: "done" },
            { label: "Generating Terraform", status: "in_progress" },
            { label: "Opening pull request", status: "pending" },
          ]}
        />

        <AssistantDrawer
          isOpen={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          subheader={
            <>
              <div>Chat with the assistant about this request.</div>
              <div className="text-[11px] text-muted-foreground">
                Working on: {moduleName || "module"} • {project || "project"}/{environment || "env"}
              </div>
            </>
          }
          width={drawerWidth}
        >
          <div className="h-full">
            <SuggestionPanel
              request={React.useMemo(() => ({
                id: "new-request",
                project,
                environment,
                module: moduleName,
                config: configObject,
                assistant_state: assistantState,
              }), [project, environment, moduleName, configObject, assistantState])}
              requestId="new-request"
              onRefresh={() => {}} // No-op for new requests
              onConfigUpdate={(updates) => {
                setFormValues(prev => ({ ...prev, ...updates }))
              }}
              onAssistantStateClear={() => {
                console.log("[NewRequest] Clearing assistant state")
                setAssistantState(null)
              }}
            />
            <AssistantHelper
              context={{
                project,
                environment,
                module: moduleName,
                currentValues: configObject,
                fieldsMeta: selectedModule?.fields ?? [],
              }}
              onAssistantState={setAssistantState}
            />
          </div>
        </AssistantDrawer>
      </div>
    </div>
  )
}