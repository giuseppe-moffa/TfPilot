"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Info, Loader2, Search } from "lucide-react"

import { ActionProgressDialog } from "@/components/action-progress-dialog"
import { ModuleTag } from "@/components/icons/module-icon"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { listEnvironments, listProjects } from "@/config/infra-repos"
import { getRequestTemplate, type RequestTemplate } from "@/config/request-templates"
import { normalizeName, validateBaseResourceName, validateResourceName } from "@/lib/validation/resourceName"
import { getNewRequestGate } from "@/lib/new-request-gate"

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
  return "name"
}

type FieldMeta = {
  name: string
  type: "string" | "number" | "boolean" | "map" | "list" | "enum"
  label?: string
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
    className={`bg-white px-3 py-3 transition focus-within:ring-2 focus-within:ring-primary/20 focus-within:ring-offset-0 ${
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

function NewRequestPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [project, setProject] = React.useState("")
  const [environment, setEnvironment] = React.useState("")
  const [selectedEnvironmentId, setSelectedEnvironmentId] = React.useState("")
  const [apiEnvironments, setApiEnvironments] = React.useState<
    Array<{ environment_id: string; project_key: string; environment_key: string; environment_slug: string }>
  >([])
  const [loadingEnvironments, setLoadingEnvironments] = React.useState(false)
  const [moduleName, setModuleName] = React.useState("")
  const [modules, setModules] = React.useState<ModuleSchema[]>([])
  const [loadingModules, setLoadingModules] = React.useState(false)
  const [loadingSubmit, setLoadingSubmit] = React.useState(false)
  const [showCreateDialog, setShowCreateDialog] = React.useState(false)
  const [deployStatus, setDeployStatus] = React.useState<{
    deployed?: boolean
    deployPrOpen?: boolean | null
    error?: string
  } | null>(null)
  const createDialogTimerRef = React.useRef<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [formValues, setFormValues] = React.useState<Record<string, any>>({})
  const projects = listProjects()
  const environments = project ? listEnvironments(project) : []
  const [activeField, setActiveField] = React.useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const hasAppliedTemplateFromQuery = React.useRef(false)
  const [pendingEnvIdFromQuery, setPendingEnvIdFromQuery] = React.useState<string | null>(null)

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
    fetch("/api/request-templates")
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
    if (!project) {
      setApiEnvironments([])
      setSelectedEnvironmentId("")
      return
    }
    let cancelled = false
    setLoadingEnvironments(true)
    fetch(`/api/environments?project_key=${encodeURIComponent(project)}`)
      .then((res) => (res.ok ? res.json() : { environments: [] }))
      .then((data: { environments?: Array<{ environment_id: string; project_key: string; environment_key: string; environment_slug: string }> }) => {
        if (cancelled) return
        const list = data?.environments ?? []
        setApiEnvironments(list)
        if (list.length === 1) setSelectedEnvironmentId(list[0].environment_id)
        else setSelectedEnvironmentId("")
      })
      .catch(() => { if (!cancelled) setApiEnvironments([]) })
      .finally(() => { if (!cancelled) setLoadingEnvironments(false) })
    return () => { cancelled = true }
  }, [project])

  React.useEffect(() => {
    if (selectedEnvironmentId && apiEnvironments.length > 0) {
      const env = apiEnvironments.find((e) => e.environment_id === selectedEnvironmentId)
      if (env) setEnvironment(env.environment_key)
    } else if (!selectedEnvironmentId) {
      setEnvironment("")
    }
  }, [selectedEnvironmentId, apiEnvironments])

  // Fetch deploy status when environment is selected (for gating Create Request)
  React.useEffect(() => {
    if (!selectedEnvironmentId) {
      setDeployStatus(null)
      return
    }
    let cancelled = false
    fetch(`/api/environments/${selectedEnvironmentId}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: { deployed?: boolean; deployPrOpen?: boolean | null; error?: string }) => {
        if (cancelled) return
        setDeployStatus({ deployed: data.deployed, deployPrOpen: data.deployPrOpen, error: data.error })
      })
      .catch(() => { if (!cancelled) setDeployStatus({ error: "ENV_DEPLOY_CHECK_FAILED" }) })
    return () => { cancelled = true }
  }, [selectedEnvironmentId])

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

  // When opening with ?environmentId=, pre-select project and environment (e.g. from env detail "New Request")
  const hasAppliedEnvIdFromQuery = React.useRef(false)
  React.useEffect(() => {
    const envId = searchParams.get("environmentId")
    if (!envId || hasAppliedEnvIdFromQuery.current) return
    hasAppliedEnvIdFromQuery.current = true
    let cancelled = false
    fetch(`/api/environments/${envId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { environment?: { project_key: string; environment_id: string } } | null) => {
        if (cancelled || !data?.environment) return
        const env = data.environment
        setProject(env.project_key)
        setPendingEnvIdFromQuery(env.environment_id)
        setEnvStep(2)
      })
      .catch(() => { hasAppliedEnvIdFromQuery.current = false })
    return () => { cancelled = true }
  }, [searchParams])

  // Apply pending env selection once apiEnvironments is loaded for the project
  React.useEffect(() => {
    if (!pendingEnvIdFromQuery || apiEnvironments.length === 0 || loadingEnvironments) return
    const found = apiEnvironments.some((e) => e.environment_id === pendingEnvIdFromQuery)
    if (!found) return
    setSelectedEnvironmentId(pendingEnvIdFromQuery)
    setPendingEnvIdFromQuery(null)
    const next = new URLSearchParams(searchParams)
    next.delete("environmentId")
    const qs = next.toString()
    router.replace(qs ? `/requests/new?${qs}` : "/requests/new", { scroll: false })
  }, [pendingEnvIdFromQuery, apiEnvironments, loadingEnvironments, router, searchParams])

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

  const newRequestGate = React.useMemo(() => {
    if (!selectedEnvironmentId) return { allowed: false, message: "Select an environment" }
    if (deployStatus === null) return { allowed: false, message: "Checking deploy status…" }
    return getNewRequestGate(deployStatus)
  }, [selectedEnvironmentId, deployStatus])

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
    if (key === "name" && typeof value === "string") {
      value = normalizeName(value)
    }
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
          const value = formValues["name"]
          cfg[field.name] = (value && typeof value === "string" && value.trim()) ? value.trim() : (field.default ?? "")
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
    if (!moduleName) {
      setError("Module is required.")
      return
    }
    if (!selectedEnvironmentId) {
      setError("Select an Environment (create one at /environments if none exist).")
      return
    }
    
    const cfg = buildConfig()
    const nameValue = cfg.name
    if (!nameValue || typeof nameValue !== "string") {
      setError("Name is required.")
      return
    }
    const nameResult = validateResourceName(String(nameValue).trim())
    if (!nameResult.ok) {
      setError(nameResult.error)
      return
    }

    setLoadingSubmit(true)
    setShowCreateDialog(false)
    createDialogTimerRef.current = window.setTimeout(() => setShowCreateDialog(true), 400)
    try {
      const payload: Record<string, unknown> = {
        environment_id: selectedEnvironmentId,
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
        const msg = data?.fieldErrors?.name || data?.error || "Failed to create request"
        throw new Error(msg)
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
    const fieldLabel = field.label ?? formatLabel(field.name)

    const fieldId = `field-${field.name}`

    // Name from Step 2 (generatedName = logical name + shortId) is read-only in Step 3
    const primaryKey = selectedModule ? primaryIdKeyForModule(selectedModule.type) : ""
    const isNameFromStep2 = Boolean(generatedName && field.name === primaryKey)
    // Name is always included and user cannot amend; do not show required asterisk
    const showRequired = field.name === "name" ? false : field.required

    switch (field.type) {
      case "boolean":
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={fieldLabel}
            description={description}
            required={showRequired}
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
            label={fieldLabel}
            description={description}
            required={showRequired}
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
            label={fieldLabel}
            description={description}
            required={showRequired}
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
            label={fieldLabel}
            description={description}
            required={showRequired}
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
            label={fieldLabel}
            description={description}
            required={showRequired}
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
      default: {
        const isNameField = field.name === "name" || field.name === primaryKey
        const nameValidation = isNameField
          ? isNameFromStep2
            ? validateResourceName(String(value ?? ""))
            : validateBaseResourceName(String(value ?? ""))
          : null
        const nameError = nameValidation && !nameValidation.ok ? nameValidation.error : null
        return (
          <FieldCard
            key={field.name}
            id={fieldId}
            label={fieldLabel}
            description={description}
            required={showRequired}
            fullWidth={fullWidth}
          >
            <div className="space-y-1">
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
              {nameError ? (
                <p className="text-xs text-destructive" role="alert">
                  {nameError}
                </p>
              ) : null}
            </div>
          </FieldCard>
        )
      }
    }
  }

  const summaryItems = React.useMemo(() => {
    const items: { label: string; value: any }[] = []
    if (selectedModule) {
      for (const f of selectedModule.fields) {
        if (f.readOnly) continue
        if (configObject[f.name] === undefined) continue
        const label = f.label ?? f.name
        items.push({ label, value: configObject[f.name] })
      }
    }
    return items
  }, [selectedModule, configObject])

  const isNameInvalid = React.useMemo(() => {
    const nameVal = configObject.name
    if (nameVal == null || typeof nameVal !== "string" || !String(nameVal).trim()) return true
    const result = validateResourceName(String(nameVal).trim())
    return !result.ok
  }, [configObject.name])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          {envStep === 1 ? (
            <>
                <div className="text-base font-semibold">New Request</div>
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
                        className="border border-border bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 hover:shadow-md hover:outline hover:outline-1 hover:outline-primary/30"
                      >
                        <div className="font-semibold text-foreground">{t.label}</div>
                        {t.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.moduleKey ? (
                            <span className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              <ModuleTag module={t.moduleKey} />
                            </span>
                          ) : null}
                          {t.id === "blank" || !t.environment ? (
                            <span className="bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Custom
                            </span>
                          ) : (
                            <span className="bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {t.environment === "prod" ? "Prod" : "Dev"}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
            </>
            ) : envStep === 2 ? (
            <>
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
                  const step2NameValidation = validateBaseResourceName(environmentName)
                  const nameValid = environmentName.trim().length > 0 && step2NameValidation.ok
                  const step2NameError = environmentName.trim().length > 0 && !step2NameValidation.ok ? step2NameValidation.error : null
                  const normalizedStep2 = environmentName.trim().toLowerCase()
                  const step2SuggestHyphens = step2NameError && /\s/.test(normalizedStep2)
                    ? normalizedStep2.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || ""
                    : ""
                  return (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Name *</Label>
                          <Input
                            value={environmentName}
                            onChange={(e) => setEnvironmentName(e.target.value.toLowerCase())}
                            placeholder="e.g. my-app"
                          />
                          <p className="text-xs text-muted-foreground">
                            Logical name for this resource. A unique suffix is automatically appended.
                          </p>
                          {step2NameError ? (
                            <>
                              <p className="text-xs text-destructive" role="alert">{step2NameError}</p>
                              {step2SuggestHyphens ? (
                                <p className="text-xs text-muted-foreground">Try: {step2SuggestHyphens}</p>
                              ) : null}
                            </>
                          ) : environmentName.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Enter a name to continue.</p>
                          ) : null}
                        </div>
                        {showProjectSelector ? (
                          <>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Project</Label>
                              <Select
                                value={project}
                                onValueChange={(v) => {
                                  setProject(v)
                                  setEnvironment(listEnvironments(v)[0] ?? "")
                                  setSelectedEnvironmentId("")
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
                              <Label className="text-sm font-medium">Environment *</Label>
                              <Select
                                value={selectedEnvironmentId}
                                onValueChange={setSelectedEnvironmentId}
                                disabled={!project || loadingEnvironments}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue
                                    placeholder={
                                      !project
                                        ? "Select project first"
                                        : loadingEnvironments
                                          ? "Loading..."
                                          : apiEnvironments.length === 0
                                            ? "No environments — create one at /environments"
                                            : "Select environment"
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {apiEnvironments.map((env) => (
                                    <SelectItem key={env.environment_id} value={env.environment_id}>
                                      {env.environment_key} / {env.environment_slug}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {project && apiEnvironments.length === 0 && !loadingEnvironments ? (
                                <p className="text-xs text-muted-foreground">
                                  <Link href="/environments" className="underline">Create an environment</Link> first.
                                </p>
                              ) : selectedEnvironmentId && !newRequestGate.allowed && newRequestGate.message ? (
                                <p className="text-xs text-amber-600 dark:text-amber-500" role="alert">
                                  {newRequestGate.message}
                                </p>
                              ) : null}
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
                                  setSelectedEnvironmentId("")
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
                              <Label className="text-sm font-medium">Environment *</Label>
                              <Select
                                value={selectedEnvironmentId}
                                onValueChange={setSelectedEnvironmentId}
                                disabled={!project || loadingEnvironments}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue
                                    placeholder={
                                      !project
                                        ? "Select project first"
                                        : loadingEnvironments
                                          ? "Loading..."
                                          : apiEnvironments.length === 0
                                            ? "No environments — create one at /environments"
                                            : `Select ${t.environment || "environment"}`
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {apiEnvironments
                                    .filter((e) => !t.environment || e.environment_key === t.environment)
                                    .map((env) => (
                                      <SelectItem key={env.environment_id} value={env.environment_id}>
                                        {env.environment_key} / {env.environment_slug}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                              {project && apiEnvironments.length === 0 && !loadingEnvironments ? (
                                <p className="text-xs text-muted-foreground">
                                  <Link href="/environments" className="underline">Create an environment</Link> first.
                                </p>
                              ) : selectedEnvironmentId && !newRequestGate.allowed && newRequestGate.message ? (
                                <p className="text-xs text-amber-600 dark:text-amber-500" role="alert">
                                  {newRequestGate.message}
                                </p>
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="mt-auto flex justify-end gap-2 pt-2">
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
                            !nameValid ||
                            !project ||
                            !selectedEnvironmentId ||
                            !newRequestGate.allowed ||
                            (showProjectSelector ? (!t.moduleKey && !moduleName) : false)
                          }
                          onClick={() => {
                            setEnvStep(3)
                            if (t) {
                              const trimmedName = environmentName.trim()
                              const shortId = randomShortId()
                              const env = apiEnvironments.find((e) => e.environment_id === selectedEnvironmentId)
                              const envPart = env ? env.environment_key : ""
                              const fullName = [project, envPart, trimmedName, shortId]
                                .filter(Boolean)
                                .join("-")
                                .toLowerCase()
                                .replace(/[^a-z0-9-]/g, "-")
                                .replace(/-+/g, "-")
                                .replace(/^-|-$/g, "") || `${trimmedName}-${shortId}`
                              setGeneratedName(fullName)
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
                                name: fullName,
                                [primaryKey]: fullName,
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
            </>
            ) : (
            <div className="space-y-6">
              {selectedTemplateId && (() => {
                const t = getRequestTemplate(requestTemplates, selectedTemplateId)
                if (!t) return null
                return (
                  <div className="border border-border rounded-md p-4 bg-muted/30">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{t.label}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{generatedName || environmentName.trim() || "—"}</span>
                      <span className="bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {project}
                      </span>
                      <span className="bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.environment || "—"}
                      </span>
                    </div>
                  </div>
                )
              })()}
              <div className="space-y-4">
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
              </div>
              <div className="space-y-4">
                <div className="text-base font-semibold">Configuration</div>
                {!selectedModule && (
                  <div className="text-sm text-muted-foreground">Select a module to view its inputs.</div>
                )}
                {selectedModule && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 bg-white px-3 py-2 text-xs text-muted-foreground">
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
                      <details className="bg-white p-3" open={false}>
                        <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
                        <div className="mt-3 space-y-3">
                          {fieldsAdvanced.map((f) => renderField(f))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="text-base font-semibold">Configuration Summary</div>
                <div className="space-y-2 text-sm">
                  {summaryItems.length === 0 && (
                    <div className="text-muted-foreground">No fields set.</div>
                  )}
                  {summaryItems.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between bg-white px-3 py-2"
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {JSON.stringify(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
                {error && <div className="text-xs text-destructive">{error}</div>}
                {!newRequestGate.allowed && newRequestGate.message ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500" role="alert">
                    {newRequestGate.message}
                  </p>
                ) : null}
                <div className="flex justify-end pt-2">
                  <Button
                    disabled={
                      loadingSubmit ||
                      !project ||
                      !selectedEnvironmentId ||
                      !moduleName ||
                      isNameInvalid ||
                      !newRequestGate.allowed
                    }
                    onClick={handleSubmit}
                  >
                    {loadingSubmit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {loadingSubmit ? "Creating..." : "Create Request"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

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
    </div>
  )
}

export default function NewRequestPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewRequestPageContent />
    </Suspense>
  )
}