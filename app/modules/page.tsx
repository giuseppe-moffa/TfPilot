"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

type ModuleInput = {
  name: string
  type: string
  default?: unknown
  description?: string
}

type ModuleMeta = {
  name: string
  description: string
  inputs: ModuleInput[]
  category: string
}

export default function ModulesPage() {
  const [modules, setModules] = React.useState<ModuleMeta[]>([])
  const [selected, setSelected] = React.useState<ModuleMeta | null>(null)
  const [formValues, setFormValues] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/modules/catalog")
        if (!res.ok) throw new Error("Failed to load catalog")
        const data = (await res.json()) as { modules: ModuleMeta[] }
        if (active) {
          setModules(data.modules || [])
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load catalog")
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const handleSelect = React.useCallback(
    (value: string) => {
      const mod = modules.find((m) => m.name === value) || null
      setSelected(mod)
      if (mod) {
        const defaults: Record<string, string> = {}
        mod.inputs?.forEach((input) => {
          if (input.default !== undefined) {
            defaults[input.name] = String(input.default)
          }
        })
        setFormValues(defaults)
      } else {
        setFormValues({})
      }
    },
    [modules]
  )

  const handleChange = React.useCallback((key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Module Catalog</h1>
        <p className="text-muted-foreground">
          Choose a module and configure its inputs. Resource selection is powered by metadata from the
          tfplan catalog.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Module Config</CardTitle>
          <CardDescription>Select a resource type and provide input values.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div className="space-y-2">
              <Label htmlFor="module">Resource Type</Label>
              <Select
                disabled={loading || modules.length === 0}
                onValueChange={handleSelect}
                value={selected?.name}
              >
                <SelectTrigger id="module">
                  <SelectValue placeholder={loading ? "Loading..." : "Select a module"} />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((mod) => (
                    <SelectItem key={mod.name} value={mod.name}>
                      {mod.name} — {mod.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleSelect(selected?.name || "")}
                disabled={loading}
              >
                Refresh defaults
              </Button>
            </div>
          </div>

          <Separator />

          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{selected.name}</p>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {selected.inputs?.map((input) => (
                  <div key={input.name} className="space-y-2">
                    <Label htmlFor={input.name}>
                      {input.name} <span className="text-xs text-muted-foreground">({input.type})</span>
                    </Label>
                    <Input
                      id={input.name}
                      value={formValues[input.name] ?? ""}
                      onChange={(e) => handleChange(input.name, e.target.value)}
                      placeholder={input.default !== undefined ? String(input.default) : ""}
                    />
                    {input.description && (
                      <p className="text-xs text-muted-foreground">{input.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a module to view and edit its inputs.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}