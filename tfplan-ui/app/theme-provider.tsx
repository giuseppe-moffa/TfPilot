"use client"

import * as React from "react"

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const manualPreference = React.useRef(false)
  const [theme, setTheme] = React.useState<Theme>("dark")

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const stored = window.localStorage.getItem("theme")
    if (stored === "light" || stored === "dark") {
      manualPreference.current = true
      setTheme(stored)
    } else {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      setTheme(media.matches ? "dark" : "dark")
      const handleChange = (event: MediaQueryListEvent) => {
        if (manualPreference.current) return
        setTheme(event.matches ? "dark" : "light")
      }
      media.addEventListener("change", handleChange)
      return () => media.removeEventListener("change", handleChange)
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.colorScheme = theme === "dark" ? "dark" : "light"
    window.localStorage.setItem("theme", theme)
  }, [theme])

  const setAndRemember = React.useCallback((next: Theme) => {
    manualPreference.current = true
    setTheme(next)
  }, [])

  const toggleTheme = React.useCallback(() => {
    setAndRemember(theme === "dark" ? "light" : "dark")
  }, [setAndRemember, theme])

  const value = React.useMemo(
    () => ({
      theme,
      setTheme: setAndRemember,
      toggleTheme,
    }),
    [setAndRemember, theme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return ctx
}
