"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Info, Loader2, Sparkles } from "lucide-react"

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
    className={`rounded-lg border border-border bg-card/80 px-3 py-3 shadow-sm transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 focus-within:ring-offset-0 ${
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
  const [project, setProject] = React.useState("")
  const [environment, setEnvironment] = React.useState("")
  const [moduleName, setModuleName] = React.useState("")
  const [modules, setModules] = React.useState<ModuleSchema[]>([])
  const [loadingModules, setLoadingModules] = React.useState(false)
  const [loadingSubmit, setLoadingSubmit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [formValues, setFormValues] = React.useState<Record<string, any>>({})
  const [assistantState, setAssistantState] = React.useState<any>(null)
  const projects = listProjects()
  const environments = project ? listEnvironments(project) : []
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const drawerWidth = 520
  const [activeField, setActiveField] = React.useState<string | null>(null)

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

  const fieldsCore = React.useMemo(
    () => (selectedModule?.fields ?? []).filter((f) => (f.category ?? "core") === "core" && !f.readOnly),
    [selectedModule?.fields]
  )
  const fieldsAdvanced = React.useMemo(
    () => (selectedModule?.fields ?? []).filter((f) => (f.category ?? "core") !== "core" && !f.readOnly),
    [selectedModule?.fields]
  )

  const setDefaults = React.useCallback(
    (mod?: ModuleSchema) => {
      if (!mod) return
      const next: Record<string, any> = {}
      for (const f of mod.fields) {
        if (f.readOnly || f.immutable) continue
        if (f.default !== undefined) {
          next[f.name] = f.default
        }
      }
      setFormValues(next)
    },
    [setFormValues]
  )

  const handleModuleChange = (value: string) => {
    setModuleName(value)
    setFormValues({})
    const mod = modules.find((m) => m.type === value)
    setDefaults(mod)
  }

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
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          environment,
          module: moduleName,
          config: cfg,
        }),
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
      setLoadingSubmit(false)
    }
  }

  const configObject = React.useMemo(() => buildConfig(), [buildConfig])

  const renderField = (field: FieldMeta, fullWidth = false) => {
    const value = formValues[field.name] ?? field.default ?? ""
    const description = field.description ?? ""

    const fieldId = `field-${field.name}`

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
              className="mt-1"
              value={String(value ?? "")}
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
        <Button size="sm" variant="outline" onClick={() => setAssistantOpen(true)}>
          <Sparkles className="mr-2 h-4 w-4" /> Assistant
        </Button>
      </header>

      <div className="flex-1 p-4">
        <div className="space-y-4">
          <Card className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Project</Label>
                <Select value={project} onValueChange={(v) => { setProject(v); setFormValues({}); setModuleName(""); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Environment</Label>
                <Select value={environment} onValueChange={(v) => { setEnvironment(v); setFormValues({}); setModuleName(""); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((env) => (
                      <SelectItem key={env} value={env}>
                        {env}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Module</Label>
                <Select
                  value={moduleName}
                  onValueChange={handleModuleChange}
                  disabled={!project || !environment || loadingModules}
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
            </div>
            {loadingModules && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading modules...
              </div>
            )}
          </Card>

          <Card className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="text-base font-semibold">Configuration</div>
            {!selectedModule && <div className="text-sm text-muted-foreground">Select a module to view its inputs.</div>}
            {selectedModule && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
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
                  <details className="rounded-lg border border-border bg-card p-3" open={false}>
                    <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
                    <div className="mt-3 space-y-3">
                      {fieldsAdvanced.map((f) => renderField(f))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Card>

          <Card className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="text-base font-semibold">Configuration Summary</div>
            <div className="space-y-2 text-sm">
              {summaryItems.length === 0 && <div className="text-muted-foreground">No fields set.</div>}
              {summaryItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded border border-border px-2 py-1">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground text-xs">{JSON.stringify(item.value)}</span>
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
        </div>

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