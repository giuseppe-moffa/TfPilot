"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type TeamMemberRow = {
  login: string
  displayName?: string | null
  avatarUrl?: string | null
  orgRole?: string
}

export function TeamMembersTable({
  members,
  onRemove,
  removingLogin,
}: {
  members: TeamMemberRow[]
  onRemove: (login: string) => void
  removingLogin: string | null
}) {
  if (members.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">No members yet. Add users below.</p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Login</TableHead>
          <TableHead className="w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.login} className="hover:bg-muted/30">
            <TableCell>
              <div className="flex items-center gap-3">
                {m.avatarUrl ? (
                  <img
                    src={m.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full"
                    width={32}
                    height={32}
                  />
                ) : null}
                <div>
                  <div className="font-medium">{m.displayName || m.login}</div>
                  {m.displayName && (
                    <div className="text-sm text-muted-foreground">@{m.login}</div>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              @{m.login}
              {m.orgRole && (
                <span className="ml-2 text-xs text-muted-foreground">({m.orgRole})</span>
              )}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${m.login}`}
                className="text-muted-foreground hover:text-destructive"
                disabled={removingLogin === m.login}
                onClick={() => onRemove(m.login)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
