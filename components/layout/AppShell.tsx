"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, Github, Moon, Sun } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/app/providers"
import { useTheme } from "@/app/theme-provider"

const SIDEBAR_WIDTH = 260

const primaryNavItems = [
  { label: "Environments", href: "/environments" },
  { label: "Requests", href: "/requests" },
  {
    label: "Catalogue",
    children: [
      { label: "Environment Templates", href: "/catalogue/environments" },
      { label: "Request Templates", href: "/catalogue/requests" },
    ],
  },
  { label: "Insights", href: "/insights" },
] as const

const settingsNavItems = [
  { label: "Members", href: "/settings/org" },
  { label: "Teams", href: "/settings/teams" },
  { label: "Audit", href: "/settings/audit" },
  { label: "Platform Orgs", href: "/settings/platform/orgs" },
] as const

function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/environments")) return "Environments"
  if (pathname.startsWith("/requests")) return "Resources"
  if (pathname.startsWith("/catalogue")) return "Catalogue"
  if (pathname.startsWith("/insights")) return "Insights"
  if (pathname.startsWith("/settings/org")) return "Members"
  if (pathname.startsWith("/settings/teams")) return "Teams"
  if (pathname.startsWith("/settings/audit")) return "Audit"
  if (pathname.startsWith("/settings/platform/orgs")) return "Platform Orgs"
  return ""
}

type UserOrg = { orgId: string; orgSlug: string; orgName: string }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, role, orgArchived, loading, logout, refresh } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const pageTitle = getPageTitle(pathname)

  const [orgs, setOrgs] = React.useState<UserOrg[]>([])
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(() => {
    const s = new Set<string>()
    if (pathname.startsWith("/catalogue")) s.add("Catalogue")
    return s
  })

  const isPlatformAdmin = role === "admin"
  const canAccessDespiteArchived =
    isPlatformAdmin && pathname.startsWith("/settings/platform/orgs")
  const showArchivedBlock = orgArchived && !canAccessDespiteArchived
  const visibleSettingsItems = settingsNavItems.filter(
    (item) => item.href !== "/settings/platform/orgs" || isPlatformAdmin
  )

  React.useEffect(() => {
    if (user?.login) {
      fetch("/api/auth/orgs", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : { orgs: [] }))
        .then((data: { orgs?: UserOrg[] }) => setOrgs(data.orgs ?? []))
        .catch(() => setOrgs([]))
    } else {
      setOrgs([])
    }
  }, [user?.login])

  React.useEffect(() => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (pathname.startsWith("/catalogue")) next.add("Catalogue")
      return next
    })
  }, [pathname])

  const handleOrgChange = async (orgId: string) => {
    if (!orgId || orgId === user?.orgId) return
    const res = await fetch("/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orgId }),
    })
    if (res.ok) {
      await refresh()
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-[260px] shrink-0 flex-col",
          theme === "light" ? "bg-[#162238]" : "bg-card"
        )}
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="flex h-14 items-center px-4">
          <Link
            href="/requests"
            className={cn(
              "text-lg font-semibold transition-colors",
              theme === "light" ? "text-white hover:text-white/80" : "text-foreground hover:text-foreground/80"
            )}
          >
            TfPilot
          </Link>
        </div>
        {user && (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              <div className="grid w-full grid-cols-1">
              {primaryNavItems.map((item) => {
              if ("children" in item) {
                const parentItem = item
                const isParentActive = parentItem.children.some(
                  (c) => pathname === c.href || pathname.startsWith(c.href + "/")
                )
                const isExpanded = expandedSections.has(parentItem.label)
                return (
                  <div key={parentItem.label} className="w-full shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSections((prev) => {
                          const next = new Set(prev)
                          if (next.has(parentItem.label)) next.delete(parentItem.label)
                          else next.add(parentItem.label)
                          return next
                        })
                      }
                      className={cn(
                        "flex w-full items-center gap-1 px-5 py-3 text-sm font-medium transition-colors border-l-4 border-transparent text-left cursor-pointer",
                        theme === "light"
                          ? isParentActive
                            ? "border-sky-400 bg-white/15 font-semibold text-sky-400"
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                          : isParentActive
                            ? "border-sky-400 bg-muted font-semibold text-sky-400"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      <span>{parentItem.label}</span>
                      {isExpanded ? (
                        <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </button>
                    <div
                      className="grid transition-[grid-template-rows] duration-300 ease-out"
                      style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                    >
                      <div className="overflow-hidden min-h-0 border-l-4 border-transparent pl-2">
                        {parentItem.children.map((child) => {
                          const isChildActive = pathname === child.href || pathname.startsWith(child.href + "/")
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "flex items-center px-5 py-2 text-sm transition-colors border-l-4 border-transparent",
                                theme === "light"
                                  ? isChildActive
                                    ? "font-semibold text-sky-400"
                                    : "text-slate-300 hover:text-white"
                                  : isChildActive
                                    ? "font-semibold text-sky-400"
                                    : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {child.label}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              }
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <div key={item.href} className="w-full shrink-0">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex w-full items-center px-5 py-3 text-sm font-medium transition-colors border-l-4 border-transparent",
                    theme === "light"
                      ? isActive
                        ? "border-sky-400 bg-white/15 font-semibold text-sky-400"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                      : isActive
                        ? "border-sky-400 bg-muted font-semibold text-sky-400"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
                </div>
              )
            })}
            </div>
            </div>
            <div
              className={cn(
                "shrink-0 border-t py-3",
                theme === "light" ? "border-white/10" : "border-border"
              )}
            >
              <div
                className={cn(
                  "px-5 py-1.5 text-xs font-medium uppercase tracking-wider",
                  theme === "light" ? "text-slate-400" : "text-muted-foreground"
                )}
              >
                Settings
              </div>
              <div className="mt-1 pl-2">
                {visibleSettingsItems.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/")
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center px-3 py-2 text-sm transition-colors rounded-md",
                        theme === "light"
                          ? isActive
                            ? "font-semibold text-sky-400 bg-white/10"
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                          : isActive
                            ? "font-semibold text-sky-400 bg-muted"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          </nav>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pl-[260px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 bg-card px-8 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.12),0_2px_4px_-2px_rgba(0,0,0,0.08)] backdrop-blur">
          <h1 className="min-w-56 shrink-0 text-lg font-semibold text-foreground truncate">
            {pageTitle}
          </h1>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={toggleTheme}
              className="h-9 w-9 text-foreground/80 hover:text-foreground hover:bg-transparent focus-visible:bg-transparent"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {user ? (
              <>
                {user.avatarUrl && (
                  <Image
                    src={user.avatarUrl}
                    alt={user.login}
                    width={28}
                    height={28}
                    className="rounded-full border"
                  />
                )}
                {user.orgSlug &&
                  (orgs.length > 1 ? (
                    <Select
                      value={user.orgId ?? ""}
                      onValueChange={handleOrgChange}
                    >
                      <SelectTrigger size="sm" className="h-7 w-fit min-w-[100px] text-[10px]">
                        <SelectValue placeholder="Org" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => (
                          <SelectItem key={o.orgId} value={o.orgId}>
                            {o.orgSlug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground border-muted-foreground/30"
                    >
                      {user.orgSlug}
                    </Badge>
                  ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logout()}
                  className="shrink-0 bg-muted hover:bg-muted/90 dark:bg-muted/60 dark:hover:bg-muted/70"
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" asChild disabled={loading} className="gap-2">
                <Link href="/login">
                  <Github className="h-4 w-4" />
                  Sign in with GitHub
                </Link>
              </Button>
            )}
          </div>
        </header>
        <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col p-8">
          {showArchivedBlock ? (
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-6 py-8 text-center max-w-md">
                <h2 className="text-lg font-semibold text-destructive">Organization archived</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This organization has been archived. Switch to another organization to continue.
                </p>
                {orgs.length > 0 ? (
                  <div className="mt-4">
                    <Select value="" onValueChange={handleOrgChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Switch organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => (
                          <SelectItem key={o.orgId} value={o.orgId}>
                            {o.orgName} ({o.orgSlug})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    You have no other organizations.
                    {isPlatformAdmin && (
                      <span className="block mt-2">
                        <Link
                          href="/settings/platform/orgs"
                          className="text-primary hover:underline"
                        >
                          Go to Platform Orgs
                        </Link>{" "}
                        to restore this organization.
                      </span>
                    )}
                    {!isPlatformAdmin && " Contact an administrator."}
                  </p>
                )}
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  )
}
