"use client"

import * as React from "react"

type AuthUser = {
  login: string
  name: string | null
  avatarUrl: string | null
  orgId?: string
  orgSlug?: string
}

type AuthContextValue = {
  user: AuthUser | null
  /** Org-scoped role from org_memberships (viewer, developer, approver, admin). */
  orgRole: "viewer" | "developer" | "approver" | "admin" | null
  /** True when orgRole === "admin". */
  isOrgAdmin: boolean
  /** True when user is in platform_admins table. */
  isPlatformAdmin: boolean
  /** True when session has orgId and that org is archived. */
  orgArchived: boolean
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

type AwsConnectionState = {
  isConnected: boolean
  accountId: string | null
  region: string | null
}

type AwsConnectionContextValue = AwsConnectionState & {
  setConnection: (data: AwsConnectionState) => void
  clearConnection: () => void
}

const AwsConnectionContext = React.createContext<AwsConnectionContextValue | null>(null)

const STORAGE_KEY = "awsConnection"

type SessionData = {
  user: AuthUser | null
  orgRole: "viewer" | "developer" | "approver" | "admin" | null
  isOrgAdmin: boolean
  isPlatformAdmin: boolean
  orgArchived: boolean
}

async function fetchSession(): Promise<SessionData> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" })
    if (!res.ok) return { user: null, orgRole: null, isOrgAdmin: false, isPlatformAdmin: false, orgArchived: false }
    const data = (await res.json()) as {
      authenticated: boolean
      user?: AuthUser
      orgRole?: "viewer" | "developer" | "approver" | "admin"
      isOrgAdmin?: boolean
      isPlatformAdmin?: boolean
      org?: { orgId: string; orgSlug: string; orgArchived?: boolean }
    }
    if (!data.authenticated || !data.user) return { user: null, orgRole: null, isOrgAdmin: false, isPlatformAdmin: false, orgArchived: false }
    return {
      user: data.user,
      orgRole: data.orgRole ?? null,
      isOrgAdmin: Boolean(data.isOrgAdmin),
      isPlatformAdmin: Boolean(data.isPlatformAdmin),
      orgArchived: Boolean(data.org?.orgArchived),
    }
  } catch {
    return { user: null, orgRole: null, isOrgAdmin: false, isPlatformAdmin: false, orgArchived: false }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [orgRole, setOrgRole] = React.useState<"viewer" | "developer" | "approver" | "admin" | null>(null)
  const [isOrgAdmin, setIsOrgAdmin] = React.useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = React.useState(false)
  const [orgArchived, setOrgArchived] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    const { user: u, orgRole: r, isOrgAdmin: oa, isPlatformAdmin: pa, orgArchived: oarch } = await fetchSession()
    setUser(u)
    setOrgRole(r)
    setIsOrgAdmin(oa)
    setIsPlatformAdmin(pa)
    setOrgArchived(oarch)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } finally {
      setUser(null)
      setOrgRole(null)
      setIsOrgAdmin(false)
      setIsPlatformAdmin(false)
      setOrgArchived(false)
      setLoading(false)
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        orgRole,
        isOrgAdmin,
        isPlatformAdmin,
        orgArchived,
        loading,
        refresh,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}

function loadFromStorage(): AwsConnectionState {
  if (typeof window === "undefined") {
    return { isConnected: false, accountId: null, region: null }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { isConnected: false, accountId: null, region: null }
    const parsed = JSON.parse(raw) as AwsConnectionState
    return {
      isConnected: Boolean(parsed.isConnected),
      accountId: parsed.accountId ?? null,
      region: parsed.region ?? null,
    }
  } catch {
    return { isConnected: false, accountId: null, region: null }
  }
}

export function AwsConnectionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AwsConnectionState>({
    isConnected: false,
    accountId: null,
    region: null,
  })

  React.useEffect(() => {
    setState(loadFromStorage())
  }, [])

  const setConnection = React.useCallback((data: AwsConnectionState) => {
    setState(data)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
  }, [])

  const clearConnection = React.useCallback(() => {
    setState({ isConnected: false, accountId: null, region: null })
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  return (
    <AwsConnectionContext.Provider value={{ ...state, setConnection, clearConnection }}>
      {children}
    </AwsConnectionContext.Provider>
  )
}

export function useAwsConnection() {
  const ctx = React.useContext(AwsConnectionContext)
  if (!ctx) {
    throw new Error("useAwsConnection must be used within AwsConnectionProvider")
  }
  return ctx
}
