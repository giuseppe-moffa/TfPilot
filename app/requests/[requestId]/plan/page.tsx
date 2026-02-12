"use client"

import * as React from "react"
import { RefreshCcw } from "lucide-react"
import { useParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Code } from "@/components/ui/code"

function lineClass(line: string) {
  if (line.trimStart().startsWith("+")) {
    return "bg-emerald-50 text-emerald-800"
  }
  if (line.trimStart().startsWith("-")) {
    return "bg-red-50 text-red-800"
  }
  return "text-slate-800"
}

function renderBlock(content: string) {
  return content
    .trim()
    .split("\n")
    .map((line, idx) => (
      <div key={idx} className={`rounded px-2 py-0.5 ${lineClass(line)}`}>
        {line}
      </div>
    ))
}

export default function PlanDiffPage() {
  const routeParams = useParams()
  const requestId =
    typeof routeParams?.requestId === "string"
      ? routeParams.requestId
      : Array.isArray(routeParams?.requestId)
        ? routeParams.requestId[0]
        : undefined

  const [isLoading, setIsLoading] = React.useState(true)
  const [planDiff, setPlanDiff] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!requestId) return
    let active = true
    async function load() {
      try {
        const res = await fetch("/api/requests")
        if (!res.ok) throw new Error("Failed to fetch request")
        const data = (await res.json()) as {
          success: boolean
          requests?: Array<{
            id: string
            plan?: { diff?: string }
          }>
        }
        if (!active) return
        const match = data.requests?.find((r) => r.id === requestId)
        if (match?.plan?.diff) {
          setPlanDiff(match.plan.diff)
        } else {
          setPlanDiff(null)
        }
      } catch (err) {
        console.error("[plan page] fetch error", err)
        if (active) setPlanDiff(null)
      } finally {
        if (active) setIsLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [requestId])

  if (!requestId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Not Found</CardTitle>
          <CardDescription>No request ID provided.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Terraform Plan for {requestId}
          </h1>
          <p className="text-muted-foreground">
            Compare current state versus proposed changes for this request.
          </p>
        </div>
        <Button className="gap-2">
          <RefreshCcw className="size-4" />
          Run Plan Again
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Terraform Plan Diff</CardTitle>
          <CardDescription>Latest diff returned by the generator.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading plan...</p>
          ) : planDiff ? (
            <div className="rounded-lg border bg-slate-950 text-slate-100">
              <Code className="bg-transparent p-4 text-sm leading-6">
                {renderBlock(planDiff)}
              </Code>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Plan not generated yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
