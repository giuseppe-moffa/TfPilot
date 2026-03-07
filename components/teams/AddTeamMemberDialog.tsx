"use client"

import * as React from "react"

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

type OrgMember = {
  login: string
  display_name: string | null
  avatar_url: string | null
  role: string
}

export function AddTeamMemberDialog({
  open,
  onOpenChange,
  teamName,
  availableMembers,
  onAdd,
  loading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamName: string
  availableMembers: OrgMember[]
  onAdd: (login: string) => Promise<void>
  loading: boolean
}) {
  const [login, setLogin] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setLogin("")
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim()) return
    setError(null)
    try {
      await onAdd(login.trim())
      onOpenChange(false)
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Failed to add member")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Add an org member to &quot;{teamName}&quot;. They will inherit the team&apos;s project
            access.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-member" className="text-sm font-medium">
              Member
            </label>
            <Select
              value={login}
              onValueChange={setLogin}
              disabled={loading || availableMembers.length === 0}
            >
              <SelectTrigger id="add-member" type="button">
                <SelectValue
                  placeholder={
                    availableMembers.length === 0
                      ? "All org members are already in this team"
                      : "Select member"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((m) => (
                  <SelectItem key={m.login} value={m.login}>
                    {m.display_name ? `${m.display_name} (@${m.login})` : m.login}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !login.trim() || availableMembers.length === 0}
            >
              {loading ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
