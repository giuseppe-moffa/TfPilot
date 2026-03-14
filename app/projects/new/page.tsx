"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const PROJECT_KEY_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/
const REPO_FULL_NAME_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/

export default function NewProjectPage() {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [projectKey, setProjectKey] = React.useState("")
  const [repoFullName, setRepoFullName] = React.useState("")
  const [defaultBranch, setDefaultBranch] = React.useState("main")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    const trimmedKey = projectKey.trim().toLowerCase()
    const trimmedRepo = repoFullName.trim()
    const trimmedBranch = defaultBranch.trim()

    if (!trimmedName) errs.name = "Name is required"
    else if (trimmedName.length > 128) errs.name = "Name must be 128 characters or fewer"

    if (!trimmedKey) errs.project_key = "Project key is required"
    else if (!PROJECT_KEY_REGEX.test(trimmedKey))
      errs.project_key = "Use lowercase letters, digits, and hyphens (no leading/trailing hyphens)"

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
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          project_key: trimmedKey,
          repo_full_name: trimmedRepo,
          default_branch: trimmedBranch,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          data.error === "Validation failed"
            ? (Array.isArray(data.errors) ? data.errors.join(". ") : data.error)
            : data.error ?? "Failed to create project"
        )
        return
      }
      router.push(`/projects/${data.project?.project_key ?? trimmedKey}`)
    } catch {
      setError("Failed to create project")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="px-6 py-6">
          <h3 className="text-base font-semibold">New project</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a project to manage infrastructure repos and workspaces
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col px-6 pb-6">
          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Name *
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Infrastructure"
                autoFocus
              />
              {fieldErrors.name && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project_key" className="text-sm font-medium">
                Project key *
              </Label>
              <Input
                id="project_key"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toLowerCase())}
                placeholder="my-infra"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, hyphens. e.g. my-infra
              </p>
              {fieldErrors.project_key && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.project_key}
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
          {error && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-6 flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/projects">Cancel</Link>
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
