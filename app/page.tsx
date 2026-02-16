"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAuth, useAwsConnection } from "./providers"

export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { isConnected } = useAwsConnection()

  React.useEffect(() => {
    // Middleware handles server-side redirects, but as a fallback:
    if (loading) return
    if (!user) {
      router.replace("/login")
      return
    }
    // Redirect to /requests (which will handle AWS connection check via its own logic)
    router.replace("/requests")
  }, [router, user, loading])

  return null
}
