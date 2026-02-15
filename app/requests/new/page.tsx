"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Info, Loader2, Sparkles } from "lucide-react"

import { AssistantHelper } from "@/components/assistant-helper"
import { AssistantDrawer } from "@/components/assistant-drawer"
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
}: {
  id?: string
  label: string
  description?: string
  required?: boolean
  children: React.ReactNode
  alignEnd?: boolean
}) => (
  <div
    id={id}
    className="rounded-lg border border-border bg-card/80 px-3 py-3 shadow-sm transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 focus-within:ring-offset-0"
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
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const projects = listProjects()
  const environments = project ? listEnvironments(project) : []
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [assistantMode, setAssistantMode] = React.useState<"suggest" | "ask">("suggest")
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
    setReviewOpen(false)
    const mod = modules.find((m) => m.type === value)
    setDefaults(mod)
  }

  const handleFieldChange = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }

  React.useEffect(() => {
    if (!activeField) return
    const el = document.getElementById(`field-${activeField}`)
    el?.focus?.({ preventScroll: true })
  }, [formValues, activeField])

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
    for (const field of selectedModule.fields) {
      if (field.readOnly || field.immutable) continue
      const raw = formValues[field.name]
      const parsed = toConfigValue(field, raw)
      if (parsed === undefined) continue
      cfg[field.name] = parsed
    }
    return cfg
  }, [formValues, selectedModule])

  const handleSubmit = async () => {
    setError(null)
    if (!project || !environment || !moduleName) {
      setError("Project, environment, and module are required.")
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
          config: buildConfig(),
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

  const applyAssistantPatch = (patch: Record<string, unknown>) => {
    if (!selectedModule) return
    const allowed = new Set(selectedModule.fields.filter((f) => !f.readOnly && !f.immutable).map((f) => f.name))
    const next = { ...formValues }
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue
      next[k] = v
    }
    setFormValues(next)
    setReviewOpen(true)
  }

  const configObject = buildConfig()

  const renderField = (field: FieldMeta) => {
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
          >
            <Textarea
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
          >
            <Textarea
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
          >
            <Input
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
          >
            <Input
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
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/requests">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">New Request (Form)</h1>
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
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Configuration</div>
              <Button variant="ghost" size="sm" onClick={() => setReviewOpen((v) => !v)}>
                Review
              </Button>
            </div>
            {!selectedModule && <div className="text-sm text-muted-foreground">Select a module to view its inputs.</div>}
            {selectedModule && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="h-4 w-4" />
                  Fill required fields; optional fields may be left empty. Values are sent to the server for validation.
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Core settings</div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {fieldsCore.map((f) => renderField(f))}
                  </div>
                </div>
                {fieldsAdvanced.length > 0 && (
                  <details className="rounded-lg border border-border bg-card p-3" open={false}>
                    <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {fieldsAdvanced.map((f) => renderField(f))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Card>

          {reviewOpen && (
            <Card className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold">Configuration Summary</div>
                <Button
                  disabled={loadingSubmit || !project || !environment || !moduleName}
                  onClick={handleSubmit}
                >
                  {loadingSubmit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loadingSubmit ? "Submitting..." : "Create Request"}
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                {summaryItems.length === 0 && <div className="text-muted-foreground">No fields set.</div>}
                {summaryItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded border border-border px-2 py-1">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-muted-foreground text-xs">{JSON.stringify(item.value)}</span>
                  </div>
                ))}
              </div>
              <details className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-foreground">View JSON payload</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                  {JSON.stringify(
                    {
                      project,
                      environment,
                      module: moduleName,
                      config: configObject,
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
              {error && <div className="text-xs text-destructive">{error}</div>}
            </Card>
          )}
        </div>

        <AssistantDrawer
          isOpen={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          header={
            <div className="inline-flex rounded-md bg-muted/40 p-1 text-xs">
              <Button
                size="sm"
                variant={assistantMode === "suggest" ? "default" : "ghost"}
                onClick={() => setAssistantMode("suggest")}
              >
                Suggest
              </Button>
              <Button
                size="sm"
                variant={assistantMode === "ask" ? "default" : "ghost"}
                onClick={() => setAssistantMode("ask")}
              >
                Ask
              </Button>
            </div>
          }
          subheader={
            <>
              <div>Assistant suggests; you decide what to apply.</div>
              <div className="text-[11px] text-muted-foreground">
                Working on: {moduleName || "module"} • {project || "project"}/{environment || "env"}
              </div>
            </>
          }
          width={drawerWidth}
        >
          <AssistantHelper
            context={{
              project,
              environment,
              module: moduleName,
              currentValues: configObject,
              fieldsMeta: selectedModule?.fields ?? [],
            }}
            mode={assistantMode}
            onModeChange={setAssistantMode}
            onApplyPatch={applyAssistantPatch}
            onScrollToField={(field) => {
              const el = document.getElementById(`field-${field}`)
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
          />
        </AssistantDrawer>
      </div>
    </div>
  )
}