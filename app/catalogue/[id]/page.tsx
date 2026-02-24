"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { listEnvironments, listProjects } from "@/config/infra-repos"

/** Sentinel for "Any project" in the Select (Radix does not allow value=""). */
const ANY_PROJECT_VALUE = "__any__"

/** Minimum time to show the saving dialog (ms). */
const SAVE_DIALOG_MIN_MS = 700

/** Field names that are set per request (name, primary ids), not from template defaultConfig. */
const REQUEST_DERIVED_FIELD_NAMES = new Set([
  "name",
  "repo_name",
  "project",
  "environment",
  "request_id",
])

type FieldMeta = {
  name: string
  type: "string" | "number" | "boolean" | "map" | "list" | "enum"
  required?: boolean
  default?: unknown
  description?: string
  enum?: string[]
  immutable?: boolean
  readOnly?: boolean
  category?: string
}

type ModuleSchema = {
  type: string
  category: string
  description: string
  fields: FieldMeta[]
}

type StoredTemplate = {
  id: string
  label: string
  description?: string
  project: string
  environment: string
  module: string
  defaultConfig: Record<string, unknown>
  uiSchema?: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
  lockEnvironment?: boolean
  allowCustomProjectEnv?: boolean
}

const formatLabel = (raw: string) => {
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

function toConfigValue(field: FieldMeta, val: unknown): unknown {
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
      return {}
    }
    default:
      return val
  }
}

function validateConfig(
  config: Record<string, unknown>,
  modules: ModuleSchema[],
  moduleType: string
): string | null {
  const mod = modules.find((m) => m.type === moduleType)
  if (!mod) return null
  for (const field of mod.fields) {
    if (field.name === "tags" || field.readOnly || REQUEST_DERIVED_FIELD_NAMES.has(field.name)) continue
    const val = config[field.name]
    if (field.required && (val === undefined || val === null || val === "")) {
      return `Required field "${field.name}" is missing or empty.`
    }
    if (field.enum && val !== undefined && val !== null && val !== "" && !field.enum.includes(String(val))) {
      return `"${field.name}" must be one of: ${field.enum.join(", ")}.`
    }
    if (field.type === "number" && val !== undefined && val !== null && val !== "" && Number.isNaN(Number(val))) {
      return `"${field.name}" must be a number.`
    }
  }
  return null
}

export default function TemplateEditorPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params.id === "string" ? params.id : ""
  const isNew = id === "new"

  const [, setTemplate] = React.useState<StoredTemplate | null>(null)
  const [loading, setLoading] = React.useState(!isNew)
  const [notFound, setNotFound] = React.useState(false)
  const [readOnly, setReadOnly] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [label, setLabel] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [project, setProject] = React.useState(ANY_PROJECT_VALUE)
  const [environment, setEnvironment] = React.useState("")
  const [moduleType, setModuleType] = React.useState("")
  const [defaultConfig, setDefaultConfig] = React.useState<Record<string, unknown>>({})
  const [rawJson, setRawJson] = React.useState(false)
  const [rawJsonText, setRawJsonText] = React.useState("{}")
  const [enabled, setEnabled] = React.useState(true)

  const [modules, setModules] = React.useState<ModuleSchema[]>([])
  const [configFormValues, setConfigFormValues] = React.useState<Record<string, unknown>>({})

  const projects = React.useMemo(() => listProjects(), [])
  const projectForEnvs = project === ANY_PROJECT_VALUE ? (projects[0] ?? "") : project
  const environments = React.useMemo(() => listEnvironments(projectForEnvs), [projectForEnvs])

  React.useEffect(() => {
    if (isNew) {
      setLoading(false)
      setProject(ANY_PROJECT_VALUE)
      return
    }
    let cancelled = false
    async function load() {
      let res = await fetch(`/api/templates/admin/${id}`)
      if (cancelled) return
      if (res.ok) {
        const data = await res.json()
        setTemplate(data)
        setLabel(data.label ?? "")
        setDescription(data.description ?? "")
        setProject((data.project && String(data.project).trim()) ? data.project : ANY_PROJECT_VALUE)
        setEnvironment(data.environment ?? "")
        setModuleType(data.module ?? "")
        setDefaultConfig(data.defaultConfig ?? {})
        setRawJsonText(JSON.stringify(data.defaultConfig ?? {}, null, 2))
        setEnabled(data.enabled ?? true)
        setConfigFormValues(data.defaultConfig ?? {})
        setReadOnly(false)
        setLoading(false)
        return
      }
      res = await fetch(`/api/templates/${id}`)
      if (cancelled) return
      if (res.ok) {
        const data = await res.json()
        setTemplate(data)
        setLabel(data.label ?? "")
        setDescription(data.description ?? "")
        setProject((data.project && String(data.project).trim()) ? data.project : ANY_PROJECT_VALUE)
        setEnvironment(data.environment ?? "")
        setModuleType(data.module ?? "")
        setDefaultConfig(data.defaultConfig ?? {})
        setRawJsonText(JSON.stringify(data.defaultConfig ?? {}, null, 2))
        setEnabled(data.enabled ?? true)
        setConfigFormValues(data.defaultConfig ?? {})
        setReadOnly(true)
        setLoading(false)
        return
      }
      setNotFound(true)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, isNew, projects.length, projects])

  React.useEffect(() => {
    let cancelled = false
    async function loadModules() {
      const res = await fetch("/api/modules/schema", { cache: "no-store" })
      if (cancelled) return
      const data = await res.json()
      if (data?.modules) setModules(data.modules)
    }
    void loadModules()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedModule = React.useMemo(
    () => modules.find((m) => m.type === moduleType),
    [modules, moduleType]
  )

  const configFields = React.useMemo(() => {
    if (!selectedModule) return []
    return (selectedModule.fields ?? []).filter(
      (f) => !REQUEST_DERIVED_FIELD_NAMES.has(f.name) && f.name !== "tags" && !f.readOnly
    )
  }, [selectedModule])

  const currentConfig = React.useMemo(() => {
    if (rawJson) {
      try {
        return JSON.parse(rawJsonText) as Record<string, unknown>
      } catch {
        return defaultConfig
      }
    }
    const cfg: Record<string, unknown> = {}
    for (const field of configFields) {
      const raw = configFormValues[field.name] ?? field.default
      const parsed = toConfigValue(field, raw)
      if (parsed !== undefined) cfg[field.name] = parsed
    }
    for (const field of configFields) {
      if (field.required && !(field.name in cfg)) {
        cfg[field.name] = configFormValues[field.name] ?? field.default ?? ""
      }
    }
    return cfg
  }, [rawJson, rawJsonText, defaultConfig, configFields, configFormValues])

  const validationError = React.useMemo(() => {
    if (!label.trim()) return "Label is required."
    if (!environment.trim()) return "Environment is required."
    if (!moduleType.trim()) return "Module is required."
    return validateConfig(currentConfig, modules, moduleType)
  }, [label, environment, moduleType, currentConfig, modules])

  const handleSave = async () => {
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(true)
    const startedAt = Date.now()
    try {
      const payload = {
        label: label.trim(),
        description: description.trim() || undefined,
        project: project === ANY_PROJECT_VALUE ? "" : project.trim(),
        environment: environment.trim(),
        module: moduleType.trim(),
        defaultConfig: currentConfig,
        enabled,
      }
      if (isNew) {
        const res = await fetch("/api/templates/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error ?? "Failed to create")
        }
        const created = await res.json()
        router.replace(`/catalogue/${created.id}`)
      } else {
        const res = await fetch(`/api/templates/admin/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error ?? "Failed to update")
        }
        const updated = await res.json()
        setTemplate(updated)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, SAVE_DIALOG_MIN_MS - elapsed)
      await new Promise((r) => setTimeout(r, remaining))
      setSaving(false)
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Not found</h1>
        <Link href="/catalogue">
          <Button variant="outline">Back to catalogue</Button>
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="flex items-center justify-between gap-3">
        <Link href="/catalogue">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">
          {isNew ? "New template" : readOnly ? "View template" : "Edit template"}
        </h1>
        {readOnly ? (
          <Link href={`/requests/new?templateId=${id}`}>
            <Button size="sm">Create request</Button>
          </Link>
        ) : (
          <Button onClick={handleSave} disabled={!!validationError || saving}>
            Save
          </Button>
        )}
      </header>

      {!readOnly && (
      <Dialog open={saving} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-xs" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Saving template</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3 py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Please wait…</span>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Dev Compute" readOnly={readOnly} disabled={readOnly} className={readOnly ? "bg-muted" : ""} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" readOnly={readOnly} disabled={readOnly} className={readOnly ? "bg-muted" : ""} />
          </div>
          <div className="space-y-2">
            <Label>Project (optional – leave empty for any project)</Label>
            <Select
              value={project}
              onValueChange={(v) => {
                setProject(v)
                const forEnvs = v === ANY_PROJECT_VALUE ? (projects[0] ?? "") : v
                setEnvironment(listEnvironments(forEnvs)[0] ?? "")
              }}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_PROJECT_VALUE}>Any project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Environment *</Label>
            <Select value={environment} onValueChange={setEnvironment} disabled={readOnly}>
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Module *</Label>
            <Select value={moduleType} onValueChange={(v) => { setModuleType(v); setConfigFormValues({}); setDefaultConfig({}); }} disabled={readOnly}>
              <SelectTrigger>
                <SelectValue placeholder="Select module" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.type} value={m.type}>{m.type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Label>Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={readOnly} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Default config</h2>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (rawJson) {
                  try {
                    const parsed = JSON.parse(rawJsonText) as Record<string, unknown>
                    setConfigFormValues(parsed)
                  } catch {
                    /* keep current form values */
                  }
                } else {
                  setRawJsonText(JSON.stringify(currentConfig, null, 2))
                }
                setRawJson(!rawJson)
              }}
            >
              {rawJson ? "Form view" : "Raw JSON"}
            </Button>
          )}
        </div>
        {rawJson ? (
          <Textarea
            className={`min-h-[200px] font-mono text-sm ${readOnly ? "bg-muted" : ""}`}
            value={rawJsonText}
            onChange={(e) => setRawJsonText(e.target.value)}
            readOnly={readOnly}
            disabled={readOnly}
          />
        ) : selectedModule ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {configFields.map((field) => (
              <div key={field.name} className="space-y-1">
                <Label className="text-sm">
                  {formatLabel(field.name)}
                  {field.required ? " *" : ""}
                </Label>
                {field.type === "boolean" ? (
                  <Switch
                    checked={Boolean(configFormValues[field.name] ?? field.default)}
                    onCheckedChange={(v) => setConfigFormValues((prev) => ({ ...prev, [field.name]: v }))}
                    disabled={readOnly}
                  />
                ) : field.type === "enum" ? (
                  <Select
                    value={String(configFormValues[field.name] ?? field.default ?? "")}
                    onValueChange={(v) => setConfigFormValues((prev) => ({ ...prev, [field.name]: v }))}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.enum ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "number" ? (
                  <Input
                    type="number"
                    value={String(configFormValues[field.name] ?? field.default ?? "")}
                    onChange={(e) => setConfigFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    readOnly={readOnly}
                    disabled={readOnly}
                    className={readOnly ? "bg-muted" : ""}
                  />
                ) : (
                  <Input
                    value={String(configFormValues[field.name] ?? field.default ?? "")}
                    onChange={(e) => setConfigFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    readOnly={readOnly}
                    disabled={readOnly}
                    className={readOnly ? "bg-muted" : ""}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a module to edit default config.</p>
        )}
      </Card>
    </div>
  )
}
