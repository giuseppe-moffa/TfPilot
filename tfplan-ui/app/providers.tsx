"use client"

import * as React from "react"

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
