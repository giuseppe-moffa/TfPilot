"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PROJECT_ROLES = ["viewer", "planner", "operator", "deployer", "admin"] as const

type ProjectRole = (typeof PROJECT_ROLES)[number]

export function TeamRoleDropdown({
  teamId,
  projectId,
  role,
  disabled,
  onRoleChange,
}: {
  teamId: string
  projectId: string | null
  role: string | undefined
  disabled?: boolean
  onRoleChange: (teamId: string, projectId: string, role: string) => Promise<void>
}) {
  const [loading, setLoading] = React.useState(false)
  const handleChange = async (value: string) => {
    if (!projectId) return
    setLoading(true)
    try {
      await onRoleChange(teamId, projectId, value)
    } finally {
      setLoading(false)
    }
  }
  if (!projectId) {
    return (
      <span className="text-sm text-muted-foreground">No project</span>
    )
  }
  const effectiveRole = role && PROJECT_ROLES.includes(role as ProjectRole) ? role : ""
  return (
    <Select
      value={effectiveRole || "operator"}
      onValueChange={handleChange}
      disabled={disabled || loading}
    >
      <SelectTrigger className="w-28" type="button">
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
  )
}
