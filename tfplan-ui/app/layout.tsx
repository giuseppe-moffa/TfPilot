import type { Metadata } from "next"
import Link from "next/link"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { Button } from "@/components/ui/button"
import { AwsConnectionProvider } from "./providers"
import AwsConnectionBadge from "./aws-connection-badge"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "InfraForge",
  description: "InfraForge infrastructure management console",
}

const navItems = [
  { label: "Environments", href: "/environments" },
  { label: "Requests", href: "/requests" },
  { label: "Modules", href: "/modules" },
  { label: "AWS Connect", href: "/aws/connect" },
]

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`}
      >
        <AwsConnectionProvider>
          <div className="flex min-h-screen flex-col">
            <header className="border-b bg-white/80 backdrop-blur">
              <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                <Link
                  href="/"
                  className="text-lg font-semibold text-slate-900 hover:text-slate-700"
                >
                  InfraForge
                </Link>
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
                </div>
              </div>
            </header>
            <main className="mx-auto w-full max-w-7xl flex-1 p-8">{children}</main>
          </div>
        </AwsConnectionProvider>
      </body>
    </html>
  )
}
