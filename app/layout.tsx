import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { AuthProvider } from "./providers"
import { AwsConnectionProvider } from "./providers"
import { ThemeProvider } from "./theme-provider"
import { AppShell } from "@/components/layout/AppShell"
import { RequestStreamRevalidator } from "@/lib/sse/RequestStreamRevalidator"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "TfPilot",
  description: "TfPilot infrastructure management console",
}

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
              <RequestStreamRevalidator />
              <AppShell>{children}</AppShell>
            </AwsConnectionProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
