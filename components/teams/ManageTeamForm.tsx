"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ManageTeamForm({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  disabled,
}: {
  name: string
  description: string
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="team-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Team name"
          disabled={disabled}
          className="max-w-md"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-description" className="text-sm font-medium">
          Description
        </Label>
        <Input
          id="team-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional description"
          disabled={disabled}
          className="max-w-md"
        />
      </div>
    </div>
  )
}
