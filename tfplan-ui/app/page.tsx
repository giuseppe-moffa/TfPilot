"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAwsConnection } from "./providers"

export default function Home() {
  const router = useRouter()
  const { isConnected } = useAwsConnection()

  React.useEffect(() => {
    router.replace(isConnected ? "/requests" : "/aws/connect")
  }, [isConnected, router])

  return null
}
