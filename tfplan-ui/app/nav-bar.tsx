"use client"

import Link from "next/link"
import Image from "next/image"

import { Github } from "lucide-react"

import { Button } from "@/components/ui/button"
import AwsConnectionBadge from "./aws-connection-badge"
import { useAuth } from "./providers"

const navItems = [
  { label: "Requests", href: "/requests" },
  { label: "Modules", href: "/modules" },
  { label: "Environments", href: "/environments" },
]

export default function NavBar() {
  const { user, loading, logout } = useAuth()

  return (
    <div className="flex items-center gap-4">
      <nav className="flex items-center gap-2">
        {navItems.map((item) => (
          <Button
            key={item.href}
            variant="ghost"
            size="sm"
            asChild
            className="text-sm text-slate-700 hover:text-slate-900"
          >
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
      </nav>
      <AwsConnectionBadge />
      <div className="flex items-center gap-2">
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
            <span className="text-sm font-medium text-slate-700">{user.login}</span>
            <Button variant="outline" size="sm" onClick={() => logout()}>
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
