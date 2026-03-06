"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import { ModuleTag } from "@/components/icons/module-icon"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

function defaultConfigPreview(config: Record<string, unknown> | undefined): string {
  if (!config || Object.keys(config).length === 0) return "—"
  try {
    const str = JSON.stringify(config)
    return str.length > 80 ? str.slice(0, 80) + "…" : str
  } catch {
    return "—"
  }
}

export default function EnvTemplateDetailPage() {
  const params = useParams()
  const id = params?.id as string | undefined
  const [template, setTemplate] = React.useState<EnvTemplate | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [authRequired, setAuthRequired] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotFound(false)
    setAuthRequired(false)
    fetch(`/api/environment-templates/${id}`)
      .then((res) => {
        if (res.status === 401) {
          setAuthRequired(true)
          return null
        }
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        if (res.status === 500) {
          setError("Failed to load template")
          return null
        }
        if (!res.ok) {
          setError("Failed to load template")
          return null
        }
        return res.json()
      })
      .then((data: EnvTemplate | null) => {
        if (cancelled || !data) return
        setTemplate(data)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load template")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (authRequired) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
          <h1 className="text-xl font-semibold">Sign in to browse templates</h1>
          <p className="text-center text-muted-foreground">
            You need to be signed in to view the template catalogue.
          </p>
          <Link href="/login">
            <Button variant="outline">Sign in</Button>
          </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
            <h1 className="text-xl font-semibold">Template not found</h1>
            <p className="text-center text-muted-foreground">
              The template may have been removed or disabled.
            </p>
            <Link href="/catalogue/environments">
              <Button variant="outline">Back to catalogue</Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </Card>
      </div>
    )
  }

  if (error || !template) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
          <div className="flex flex-1 flex-col gap-4 px-6 py-6">
            <div className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error ?? "Failed to load template"}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const sortedModules = [...(template.modules ?? [])].sort((a, b) => a.order - b.order)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col pt-0 shadow-none">
        <div className="flex flex-1 flex-col gap-4 px-6 py-6">
          <h1 className="text-lg font-semibold">{template.label ?? template.id}</h1>

          <div className="space-y-4">
            {template.description ? (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-1">Description</h2>
                <p className="text-sm">{template.description}</p>
              </div>
            ) : null}

            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Modules</h2>
              {sortedModules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No modules defined.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Order</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Default config</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedModules.map((mod, i) => (
                      <TableRow key={`${mod.module}-${i}`}>
                        <TableCell className="font-mono text-sm">{mod.order}</TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            <ModuleTag module={mod.module} />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px] truncate" title={JSON.stringify(mod.defaultConfig ?? {})}>
                          {defaultConfigPreview(mod.defaultConfig)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="mt-auto flex justify-end pt-4">
            <Link href={`/environments/new?template_id=${template.id}`}>
              <Button size="sm">Use this template</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
