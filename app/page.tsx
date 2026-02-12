"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAuth, useAwsConnection } from "./providers"

export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { isConnected } = useAwsConnection()

  React.useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/login")
      return
    }
    router.replace(isConnected ? "/requests" : "/aws/connect")
  }, [isConnected, router, user, loading])

  return null
}
