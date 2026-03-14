"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { FolderOpen, FolderKanban, Layers, BarChart3, Settings, Plus, Moon, Sun, Github, ChevronRight, ChevronLeft } from "lucide-react"

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

const PRIMARY_SIDEBAR_WIDTH = 220
const CONTEXT_SIDEBAR_WIDTH = 220

const SETTINGS_ITEMS = [
  { label: "Members", href: "/settings/members" },
  { label: "Teams", href: "/settings/teams" },
  { label: "Audit", href: "/settings/audit" },
  { label: "Organisations", href: "/settings/organisations" },
] as const

function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/projects")) return "Projects"
  if (pathname.startsWith("/requests")) return "Resources"
  if (pathname.startsWith("/catalogue")) return "Catalogue"
  if (pathname.startsWith("/insights")) return "Insights"
  if (pathname.startsWith("/settings/members")) return "Members"
  if (pathname.startsWith("/settings/teams")) return "Teams"
  if (pathname.startsWith("/settings/audit")) return "Audit"
  if (pathname.startsWith("/settings/organisations")) return "Organisations"
  return ""
}

type UserOrg = { orgId: string; orgSlug: string; orgName: string }
type SidebarProject = { key: string; name: string }

function showSettingsContextPanel(pathname: string): boolean {
  return pathname.startsWith("/settings")
}


function getSelectedProjectKey(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/)
  if (!match) return null
  const key = match[1]
  if (key === "new") return null
  return key
}

type BreadcrumbItem = { label: string; href?: string }

function getBreadcrumbs(
  pathname: string,
  projects: SidebarProject[],
  orgDisplayName?: string | null
): BreadcrumbItem[] {
  const prependOrg = (items: BreadcrumbItem[]) => {
    if (orgDisplayName && items.length > 0) return [{ label: orgDisplayName }, ...items]
    return items
  }
  if (pathname === "/projects") return prependOrg([{ label: "Projects" }])
  if (pathname === "/projects/new") return prependOrg([{ label: "Projects", href: "/projects" }, { label: "Add Project" }])
  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/(.+))?$/)
  if (projectMatch) {
    const [, key, rest] = projectMatch
    const project = projects.find((p) => p.key === key)
    const name = project?.name ?? key ?? key
    if (!rest) return prependOrg([{ label: "Projects", href: "/projects" }, { label: name }])
    if (rest === "settings") return prependOrg([{ label: "Projects", href: "/projects" }, { label: name, href: `/projects/${key}` }, { label: "Settings" }])
    if (rest === "access") return prependOrg([{ label: "Projects", href: "/projects" }, { label: name, href: `/projects/${key}` }, { label: "Access" }])
    if (rest === "workspaces/new") return prependOrg([{ label: "Projects", href: "/projects" }, { label: name, href: `/projects/${key}` }, { label: "New Workspace" }])
    return prependOrg([{ label: "Projects", href: "/projects" }, { label: name, href: `/projects/${key}` }, { label: rest }])
  }
  if (pathname.startsWith("/settings")) {
    const map: Record<string, string> = {
      "/settings/members": "Members",
      "/settings/teams": "Teams",
      "/settings/audit": "Audit",
      "/settings/organisations": "Organisations",
    }
    const label = map[pathname] ?? "Settings"
    return prependOrg([{ label: "Settings", href: "/settings/members" }, { label }])
  }
  if (pathname === "/catalogue") return prependOrg([{ label: "Catalogue" }])
  if (pathname === "/catalogue/workspaces") return prependOrg([{ label: "Catalogue", href: "/catalogue" }, { label: "Workspace Templates" }])
  if (pathname === "/catalogue/requests") return prependOrg([{ label: "Catalogue", href: "/catalogue" }, { label: "Request Templates" }])
  if (pathname === "/workspaces/new") return prependOrg([{ label: "New Workspace" }])
  if (pathname.startsWith("/requests")) return prependOrg([{ label: "Resources" }])
  if (pathname.startsWith("/insights")) return prependOrg([{ label: "Insights" }])
  return []
}

function PrimarySidebar({
  pathname,
  theme,
  isPlatformAdmin,
  projects,
}: {
  pathname: string
  theme: string
  isPlatformAdmin: boolean
  projects: SidebarProject[]
}) {
  const isProjectsActive = pathname.startsWith("/projects")
  const projectKey = getSelectedProjectKey(pathname)

  const primaryItems = [
    { label: "Projects", href: "/projects", icon: FolderOpen },
    { label: "Requests", href: "/requests", icon: FolderKanban },
    { label: "Catalogue", href: "/catalogue", icon: Layers },
    { label: "Insights", href: "/insights", icon: BarChart3 },
    { label: "Settings", href: "/settings/members", icon: Settings },
  ]

  const linkBase = "flex items-center rounded-none px-3 py-2.5 text-sm font-medium transition-colors"
  const linkActive =
    theme === "light"
      ? "bg-white/15 font-semibold text-sky-400 border-l-4 border-l-sky-400"
      : "bg-muted font-semibold text-sky-400 border-l-4 border-l-sky-300"
  const linkActiveProject =
    theme === "light"
      ? "bg-white/15 font-semibold text-sky-400"
      : "bg-muted font-semibold text-sky-400"
  const linkInactiveProjects =
    theme === "light" ? "text-slate-300 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
  const ctxLinkClass = (href: string, exact?: boolean) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
    return cn(linkBase, active ? linkActiveProject : linkInactiveProjects)
  }
  const sidebarBg =
    theme === "light"
      ? "bg-[#162238] border-r border-white/10"
      : "bg-card border-r border-white/5"
  const projectSectionHeaderClass =
    theme === "light"
      ? "shrink-0 border-b border-white/5 bg-[#162238] px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400"
      : "shrink-0 border-b border-white/5 bg-card px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"

  return (
    <aside
      className={cn("fixed inset-y-0 left-0 z-30 flex w-[220px] shrink-0 flex-col overflow-y-auto box-content", sidebarBg)}
      style={{ width: PRIMARY_SIDEBAR_WIDTH }}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center justify-center border-b box-content",
          theme === "light" ? "border-white/10" : "border-white/5"
        )}
      >
        <Link
          href="/requests"
          className={cn(
            "text-base font-semibold transition-colors",
            theme === "light" ? "text-white hover:text-white/80" : "text-foreground hover:text-foreground/80"
          )}
        >
          Tf
        </Link>
      </div>

      {isProjectsActive ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-1.5", theme === "light" ? "border-white/10 bg-[#162238]" : "border-white/5 bg-card")}>
              <span className={cn("text-xs font-medium uppercase tracking-wider", theme === "light" ? "text-slate-400" : "text-muted-foreground")}>
                Projects
              </span>
              <Link
                href="/requests"
                className={cn(
                  "rounded-md p-1 transition-colors",
                  theme === "light" ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
                title="Back to main navigation"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </div>
            <div className="flex flex-col px-0">
              {projects.map((p) => (
                <Link key={p.key} href={`/projects/${p.key}`} className={ctxLinkClass(`/projects/${p.key}`)}>
                  {p.name}
                </Link>
              ))}
              <Link
                href="/projects/new"
                className={cn(
                  "flex items-center gap-2 rounded-none px-3 py-2.5 text-sm font-medium transition-colors",
                  theme === "light" ? "text-sky-400 hover:text-sky-600" : "text-sky-400 hover:bg-muted hover:text-foreground"
                )}
              >
                <Plus className="h-4 w-4" />
                Add Project
              </Link>
            </div>
          </div>
          {projectKey && (
            <div className={cn("shrink-0 border-t", theme === "light" ? "border-white/5" : "border-white/5")}>
              <div className={projectSectionHeaderClass}>Project</div>
              <div className="flex flex-col px-0">
                <Link
                  href={`/projects/${projectKey}/settings`}
                  className={cn(
                    linkBase,
                    pathname.startsWith(`/projects/${projectKey}/settings`) || pathname.startsWith(`/projects/${projectKey}/access`)
                      ? linkActive
                      : linkInactiveProjects
                  )}
                >
                  Settings
                </Link>
              </div>
            </div>
          )}
        </>
      ) : (
        <nav className="flex flex-1 flex-col">
          {primaryItems.map((item) => {
            const isActive =
              item.href === "/projects"
                ? pathname.startsWith("/projects")
                : item.href === "/settings/members"
                  ? pathname.startsWith("/settings")
                  : pathname === item.href || pathname.startsWith(item.href + "/")
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-none px-3 py-2.5 text-sm font-medium transition-colors",
                  theme === "light"
                    ? isActive
                      ? "bg-white/15 text-sky-400 border-l-4 border-l-sky-400"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                    : isActive
                      ? "bg-muted text-sky-400 border-l-4 border-l-sky-300"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      )}
    </aside>
  )
}

function SettingsContextSidebar({
  pathname,
  theme,
  isPlatformAdmin,
}: {
  pathname: string
  theme: string
  isPlatformAdmin: boolean
}) {
  const visibleItems = SETTINGS_ITEMS.filter(
    (item) => item.href !== "/settings/organisations" || isPlatformAdmin
  )
  const linkBase = "flex items-center rounded-none px-3 py-2.5 text-sm font-medium transition-colors"
  const linkClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/")
    return cn(linkBase, active ? linkActive : linkInactive)
  }
  const panelBg = theme === "light" ? "bg-slate-50 border-r border-slate-200" : "bg-card border-r border-white/5"

  const linkActiveLight = "bg-white font-semibold text-sky-600 border-l-4 border-l-sky-600"
  const linkInactiveLight = "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
  const linkActive =
    theme === "light" ? linkActiveLight : "bg-muted font-semibold text-sky-400 border-l-4 border-l-sky-300"
  const linkInactive =
    theme === "light" ? linkInactiveLight : "text-foreground hover:bg-muted/80 hover:text-foreground"

  return (
    <aside
      className={cn("flex w-[220px] shrink-0 flex-col overflow-y-auto border-r box-content", panelBg)}
      style={{ width: CONTEXT_SIDEBAR_WIDTH }}
    >
      <div className="flex flex-1 flex-col px-0">
        {visibleItems.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(item.href)}>
            {item.label}
          </Link>
        ))}
      </div>
    </aside>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isPlatformAdmin, orgArchived, loading, logout, refresh } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const pageTitle = getPageTitle(pathname)

  const [orgs, setOrgs] = React.useState<UserOrg[]>([])
  const [sidebarProjects, setSidebarProjects] = React.useState<SidebarProject[]>([])

  const showSettingsPanel = showSettingsContextPanel(pathname)
  const sidebarTotalWidth = PRIMARY_SIDEBAR_WIDTH

  const canAccessDespiteArchived =
    isPlatformAdmin && pathname.startsWith("/settings/organisations")
  const showArchivedBlock = orgArchived && !canAccessDespiteArchived

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
    if (user?.login) {
      fetch("/api/projects", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : { projects: [] }))
        .then((data: { projects?: Array<{ project_key: string; name: string }> }) => {
          setSidebarProjects(
            (data.projects ?? []).map((p) => ({
              key: p.project_key,
              name: p.name || p.project_key,
            }))
          )
        })
        .catch(() => setSidebarProjects([]))
    } else {
      setSidebarProjects([])
    }
  }, [user?.login])

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
      {user && (
        <PrimarySidebar pathname={pathname} theme={theme} isPlatformAdmin={isPlatformAdmin} projects={sidebarProjects} />
      )}
      <div
        className="flex min-w-0 flex-1 flex-col bg-background"
        style={{ marginLeft: user ? sidebarTotalWidth : 0 }}
      >
        <div className="sticky top-0 z-20 flex flex-col border-border bg-card">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-8 backdrop-blur">
          <h1 className="min-w-56 shrink-0 truncate text-lg font-semibold text-foreground">
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
                    <Select value={user.orgId ?? ""} onValueChange={handleOrgChange}>
                      <SelectTrigger size="sm" className="h-8 w-fit min-w-[80px] px-2 py-1.5 text-xs">
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
                      className="text-[10px] border-muted-foreground/30 px-1.5 py-0 font-normal text-muted-foreground"
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
              <Button
                variant="outline"
                size="sm"
                asChild
                disabled={loading}
                className="gap-2"
              >
                <Link href="/login">
                  <Github className="h-4 w-4" />
                  Sign in with GitHub
                </Link>
              </Button>
            )}
          </div>
        </header>
        {user && !showArchivedBlock && (() => {
          const crumbs = getBreadcrumbs(pathname, sidebarProjects, orgs.find((o) => o.orgId === user?.orgId)?.orgName ?? user?.orgSlug)
          if (crumbs.length <= 1) return null
          return (
            <nav
              aria-label="Breadcrumb"
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-t px-8 py-2 text-sm text-muted-foreground",
                theme === "light"
                  ? "border-t-slate-200/80"
                  : "border-t-white/5"
              )}
            >
              {crumbs.map((item, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight className="h-4 w-4 shrink-0" />}
                  {item.href ? (
                    <Link href={item.href} className="hover:text-foreground hover:underline transition-colors">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{item.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )
        })()}
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {user && showSettingsPanel && (
            <SettingsContextSidebar pathname={pathname} theme={theme} isPlatformAdmin={isPlatformAdmin} />
          )}
          <main className="mx-auto flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-8">
          {showArchivedBlock ? (
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/5 px-6 py-8 text-center">
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
                      <span className="mt-2 block">
                        <Link href="/settings/organisations" className="text-primary hover:underline">
                          Go to Organisations
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
    </div>
  )
}
