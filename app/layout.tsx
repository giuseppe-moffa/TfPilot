import type { Metadata } from "next"
import Link from "next/link"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { Button } from "@/components/ui/button"
import { AuthProvider } from "./providers"
import { AwsConnectionProvider } from "./providers"
import { ThemeProvider } from "./theme-provider"
import NavBar from "./nav-bar"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "TfPilotS",
  description: "TfPilot infrastructure management console",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const stored = localStorage.getItem("theme");
                  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  const theme = stored === "light" || stored === "dark" ? stored : (prefersDark ? "dark" : "dark");
                  const root = document.documentElement;
                  if (theme === "dark") {
                    root.classList.add("dark");
                  } else {
                    root.classList.remove("dark");
                  }
                  root.style.colorScheme = theme === "dark" ? "dark" : "light";
                } catch (e) {
                  document.documentElement.classList.add("dark");
                  document.documentElement.style.colorScheme = "dark";
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background text-foreground antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            <AwsConnectionProvider>
              <div className="flex min-h-screen flex-col">
                <header className="border-b border-border bg-background/80 backdrop-blur">
                  <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <Link href="/" className="text-lg font-semibold text-foreground hover:text-foreground/80">
                      TfPilot
                    </Link>
                    <NavBar />
                  </div>
                </header>
                <main className="mx-auto w-full max-w-7xl flex-1 p-8">{children}</main>
              </div>
            </AwsConnectionProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
