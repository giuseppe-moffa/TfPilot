"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useAwsConnection } from "./providers"

export default function AwsConnectionBadge() {
  const { isConnected, accountId, region } = useAwsConnection()

  if (isConnected && accountId && region) {
    return (
      <div className="text-xs font-medium text-slate-500">
        AWS: {accountId} ({region})
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" asChild className="text-xs">
      <Link href="/aws/connect">Connect AWS</Link>
    </Button>
  )
}
