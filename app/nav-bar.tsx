"use client"

import Link from "next/link"
import Image from "next/image"

import { Github, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import AwsConnectionBadge from "./aws-connection-badge"
import { useAuth } from "./providers"
import { useTheme } from "./theme-provider"

const navItems = [
  { label: "Requests", href: "/requests" },
  { label: "Catalogue", href: "/catalogue" },
  { label: "Environments", href: "/environments" },
]

export default function NavBar() {
  const { user, loading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex items-center gap-4">
      <nav className="flex items-center gap-2">
        {navItems.map((item) => (
          <Button
            key={item.href}
            variant="ghost"
            size="sm"
            asChild
            className="text-sm text-foreground/80 hover:text-foreground hover:bg-transparent focus-visible:bg-transparent"
          >
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
      </nav>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={toggleTheme}
        className="h-9 w-9 text-foreground/80 hover:text-foreground hover:bg-transparent focus-visible:bg-transparent"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
      <AwsConnectionBadge />
      <div className="flex items-center gap-6">
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
            <span className="text-sm font-medium text-foreground/80">{user.login}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} className="bg-muted hover:bg-muted/90 dark:bg-muted/60 dark:hover:bg-muted/70">
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
    </div>
  )
}
