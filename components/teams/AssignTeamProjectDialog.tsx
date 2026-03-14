"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PROJECT_ROLES = ["viewer", "planner", "operator", "deployer", "admin"] as const

type ProjectSummary = {
  id: string
  projectKey: string
  name: string
}

export function AssignTeamProjectDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  projects,
  existingProjectIds,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  teamName: string
  projects: ProjectSummary[]
  existingProjectIds: Set<string>
  onSuccess: () => void
}) {
  const [projectId, setProjectId] = React.useState("")
  const [role, setRole] = React.useState<string>("operator")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const availableProjects = projects.filter((p) => !existingProjectIds.has(p.id))

  React.useEffect(() => {
    if (open) {
      setProjectId("")
      setRole("operator")
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/org/teams/access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, projectId, role }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json.error as string) ?? "Failed to assign team to project")
        return
      }
      onSuccess()
      onOpenChange(false)
    } catch {
      setError("Failed to assign team to project")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Team to Project</DialogTitle>
          <DialogDescription>
            Teams receive permissions per project. Assign &quot;{teamName}&quot; to a project with a
            role.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="assign-project" className="text-xs font-medium text-muted-foreground">
              Project
            </label>
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={loading || availableProjects.length === 0}
            >
              <SelectTrigger id="assign-project" type="button">
                <SelectValue
                  placeholder={
                    availableProjects.length === 0
                      ? projects.length === 0
                        ? "No projects in org"
                        : "All projects already assigned"
                      : "Select project"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.projectKey})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableProjects.length === 0 && projects.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No projects yet.{" "}
                <Link href="/projects/new" className="text-primary hover:underline">
                  Create a project
                </Link>{" "}
                first.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="assign-role" className="text-xs font-medium text-muted-foreground">
              Role
            </label>
            <Select value={role} onValueChange={setRole} disabled={loading}>
              <SelectTrigger id="assign-role" type="button">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !projectId.trim() || availableProjects.length === 0}
            >
              {loading ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
