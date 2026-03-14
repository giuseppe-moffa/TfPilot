"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const REPO_FULL_NAME_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/

type Project = {
  id: string
  project_key: string
  name: string
  repo_full_name: string
  default_branch: string
  created_at: string
  updated_at: string
}

export default function ProjectSettingsPage() {
  const params = useParams()
  const projectId = params?.projectId as string | undefined

  const [project, setProject] = React.useState<Project | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [repoFullName, setRepoFullName] = React.useState("")
  const [defaultBranch, setDefaultBranch] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!projectId) return
    setLoading(true)
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then((res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((data: { project?: Project } | null) => {
        if (!data?.project) {
          setError("Project not found")
          return
        }
        setProject(data.project)
        setName(data.project.name ?? "")
        setRepoFullName(data.project.repo_full_name ?? "")
        setDefaultBranch(data.project.default_branch ?? "main")
        setError(null)
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return
    setSaveError(null)
    setFieldErrors({})

    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    const trimmedRepo = repoFullName.trim()
    const trimmedBranch = defaultBranch.trim()

    if (!trimmedName) errs.name = "Name is required"
    else if (trimmedName.length > 128) errs.name = "Name must be 128 characters or fewer"

    if (!trimmedRepo) errs.repo_full_name = "Repository is required"
    else if (!REPO_FULL_NAME_REGEX.test(trimmedRepo))
      errs.repo_full_name = "Use owner/repo format (e.g. acme/infra)"

    if (!trimmedBranch) errs.default_branch = "Default branch is required"
    else if (trimmedBranch.length > 255) errs.default_branch = "Branch must be 255 characters or fewer"

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId!)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          repo_full_name: trimmedRepo,
          default_branch: trimmedBranch,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(
          data.error === "Validation failed"
            ? (Array.isArray(data.errors) ? data.errors.join(". ") : data.error)
            : data.error ?? "Failed to update project"
        )
        return
      }
      if (data.project) {
        setProject((p) => (p ? { ...p, ...data.project } : data.project))
      }
    } catch {
      setSaveError("Failed to update project")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !projectId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
        <p className="text-sm text-destructive">{error ?? "Project not found"}</p>
        <Button variant="outline" asChild>
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="px-6 py-6">
          <p className="text-md font-semibold mb-1">General</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Update project name, repository, and default branch
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col px-6 pb-6">
          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="id" className="text-sm font-medium">
                ID
              </Label>
              <Input
                id="id"
                value={project.id}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Name *
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Infrastructure"
              />
              {fieldErrors.name && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="default_branch" className="text-sm font-medium">
                Default branch *
              </Label>
              <Input
                id="default_branch"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
              />
              {fieldErrors.default_branch && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.default_branch}
                </p>
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="repo_full_name" className="text-sm font-medium">
                Repository *
              </Label>
              <Input
                id="repo_full_name"
                value={repoFullName}
                onChange={(e) => setRepoFullName(e.target.value)}
                placeholder="owner/repo"
              />
              <p className="text-xs text-muted-foreground">
                GitHub repo in owner/repo format. e.g. acme/infrastructure
              </p>
              {fieldErrors.repo_full_name && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.repo_full_name}
                </p>
              )}
            </div>
          </div>
          {saveError && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {saveError}
            </p>
          )}
          <div className="mt-6 flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}`}>Cancel</Link>
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
