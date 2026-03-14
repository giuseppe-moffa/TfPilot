"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { UsersRound } from "lucide-react"
import { cn } from "@/lib/utils"

const SETTINGS_TABS = [
  { label: "General", href: (id: string) => `/projects/${id}/settings` },
  { label: "Access", href: (id: string) => `/projects/${id}/access` },
] as const

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const projectId = params?.projectId as string | undefined
  const isSettings = pathname?.startsWith(`/projects/${projectId}/settings`)
  const isAccess = pathname?.startsWith(`/projects/${projectId}/access`)
  const showSettingsTabs = isSettings || isAccess

  if (!projectId) return <>{children}</>

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {showSettingsTabs && (
        <div className="flex gap-1 border-b border-border">
          {SETTINGS_TABS.map((tab) => {
            const href = tab.href(projectId)
            const isActive =
              tab.label === "General"
                ? pathname === href || pathname === href.replace(/\/$/, "")
                : pathname?.startsWith(href)
            const Icon = tab.label === "Access" ? UsersRound : null
            return (
              <Link
                key={tab.label}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {tab.label}
              </Link>
            )
          })}
        </div>
      )}
      {children}
    </div>
  )
}
