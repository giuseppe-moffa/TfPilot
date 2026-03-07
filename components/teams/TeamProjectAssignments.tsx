"use client"

import * as React from "react"
import { X, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"

export type ProjectAssignment = {
  projectId: string
  projectName: string
  role: string
}

const MAX_VISIBLE = 2

export function TeamProjectAssignments({
  teamId,
  assignments,
  projectsAvailable,
  onAssign,
  onRemove,
  removingProjectId,
}: {
  teamId: string
  assignments: ProjectAssignment[]
  projectsAvailable: boolean
  onAssign: () => void
  onRemove: (teamId: string, projectId: string) => void
  removingProjectId: string | null
}) {
  if (assignments.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">No projects assigned</span>
        {projectsAvailable && (
          <button
            type="button"
            onClick={onAssign}
            className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            + Assign Project
          </button>
        )}
      </div>
    )
  }

  const visible = assignments.slice(0, MAX_VISIBLE)
  const overflow = assignments.length - MAX_VISIBLE

  return (
    <div className="flex flex-col gap-1.5">
      {visible.map((a) => (
        <div
          key={a.projectId}
          className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-sm"
        >
          <span className="truncate">
            {a.projectName} → {a.role}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${a.projectName} assignment`}
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
            disabled={removingProjectId === a.projectId}
            onClick={() => onRemove(teamId, a.projectId)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {overflow > 0 && (
        <span className="text-xs text-muted-foreground">+{overflow} more</span>
      )}
      {projectsAvailable && (
        <button
          type="button"
          onClick={onAssign}
          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          + Assign Project
        </button>
      )}
    </div>
  )
}
