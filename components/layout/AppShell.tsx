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

const navItems = [
  { label: "Environments", href: "/environments" },
  { label: "Resources", href: "/requests" },
  {
    label: "Catalogue",
    children: [
      { label: "Environment Templates", href: "/catalogue/environments" },
      { label: "Request Templates", href: "/catalogue/requests" },
    ],
  },
  { label: "Insights", href: "/insights" },
  { label: "Organisations", href: "/settings/org" },
] as const

function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/environments")) return "Environments"
  if (pathname.startsWith("/requests")) return "Resources"
  if (pathname.startsWith("/catalogue")) return "Catalogue"
  if (pathname.startsWith("/insights")) return "Insights"
  if (pathname.startsWith("/settings/org")) return "Organisation Settings"
  return ""
}

type UserOrg = { orgId: string; orgSlug: string; orgName: string }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, logout, refresh } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const pageTitle = getPageTitle(pathname)

  const [orgs, setOrgs] = React.useState<UserOrg[]>([])
  const [catalogueExpanded, setCatalogueExpanded] = React.useState(() =>
    pathname.startsWith("/catalogue")
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
    if (pathname.startsWith("/catalogue")) setCatalogueExpanded(true)
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
          <nav className="flex flex-col">
            {navItems.map((item) => {
              if ("children" in item) {
                const catalogueItem = item
                const isCatalogueActive = pathname.startsWith("/catalogue")
                return (
                  <div key={catalogueItem.label}>
                    <button
                      type="button"
                      onClick={() => setCatalogueExpanded((prev) => !prev)}
                      className={cn(
                        "flex w-full items-center gap-1 px-5 py-3 text-sm font-medium transition-colors border-l-4 border-transparent text-left cursor-pointer",
                        theme === "light"
                          ? isCatalogueActive
                            ? "border-sky-400 bg-white/15 font-semibold text-sky-400"
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                          : isCatalogueActive
                            ? "border-sky-400 bg-muted font-semibold text-sky-400"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      <span>{catalogueItem.label}</span>
                      {catalogueExpanded ? (
                        <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </button>
                    {catalogueExpanded && (
                      <div className="border-l-4 border-transparent pl-2">
                        {catalogueItem.children.map((child) => {
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
                    )}
                  </div>
                )
              }
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-5 py-3 text-sm font-medium transition-colors border-l-4 border-transparent",
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
              )
            })}
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
        <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col p-8">{children}</main>
      </div>
    </div>
  )
}
