"use client"

import * as React from "react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useOpsMetrics } from "@/lib/observability/useOpsMetrics"
import { cn } from "@/lib/utils"
import type { OpsMetricsPayload } from "@/lib/observability/ops-metrics"

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    })
  } catch {
    return iso
  }
}

function StatCard({
  title,
  value,
  sub,
  className,
}: {
  title: string
  value: React.ReactNode
  sub?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("p-4", className)}>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub != null && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

export function OpsDashboard() {
  const { metrics, isLoading, error, isValidating } = useOpsMetrics()

  if (error) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Ops</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      </div>
    )
  }

  if (isLoading && !metrics) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="text-muted-foreground">Loading metrics…</p>
      </div>
    )
  }

  const m = metrics as OpsMetricsPayload | null
  const total = m?.total ?? 0

  return (
    <div className="container mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="text-sm text-muted-foreground">Platform metrics (cached ~60s)</p>
      </header>

      {/* At a glance */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">At a glance</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total requests" value={total} />
          <StatCard
            title="Apply success rate (7d)"
            value={
              m?.applySuccessRateLast7d != null
                ? `${(m.applySuccessRateLast7d * 100).toFixed(1)}%`
                : "—"
            }
          />
          <StatCard
            title="Plan success rate (7d)"
            value={
              m?.planSuccessRateLast7d != null
                ? `${(m.planSuccessRateLast7d * 100).toFixed(1)}%`
                : "—"
            }
          />
          <StatCard
            title="Failures"
            value={`${m?.failuresLast24h ?? 0} (24h) · ${m?.failuresLast7d ?? 0} (7d)`}
          />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>Generated at: {m?.generatedAt ? formatTime(m.generatedAt) : "—"}</span>
          <span>Cache age: {m?.cacheAgeSeconds != null ? `${m.cacheAgeSeconds}s` : "0s"}</span>
          {isValidating && <span>Updating…</span>}
        </div>
      </section>

      {/* Status distribution */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Status distribution</h2>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">% of total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m?.statusCounts &&
                Object.entries(m.statusCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([status, count]) => (
                    <TableRow key={status}>
                      <TableCell className="font-medium">{status}</TableCell>
                      <TableCell className="text-right">{count}</TableCell>
                      <TableCell className="text-right">
                        {total > 0 ? ((count / total) * 100).toFixed(1) : "0"}%
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* Activity windows */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Activity windows</h2>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">24h</TableHead>
                <TableHead className="text-right">7d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Applies</TableCell>
                <TableCell className="text-right">{m?.appliesLast24h ?? 0}</TableCell>
                <TableCell className="text-right">{m?.appliesLast7d ?? 0}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Destroys</TableCell>
                <TableCell className="text-right">{m?.destroysLast24h ?? 0}</TableCell>
                <TableCell className="text-right">{m?.destroysLast7d ?? 0}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Failures</TableCell>
                <TableCell className="text-right">{m?.failuresLast24h ?? 0}</TableCell>
                <TableCell className="text-right">{m?.failuresLast7d ?? 0}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* Durations */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Durations</h2>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Value (7d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Avg apply time</TableCell>
                <TableCell className="text-right">
                  {m?.avgApplySecondsLast7d != null ? `${m.avgApplySecondsLast7d}s` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>P95 apply time</TableCell>
                <TableCell className="text-right">
                  {m?.p95ApplySecondsLast7d != null ? `${m.p95ApplySecondsLast7d}s` : "—"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Created → plan_ready
                  <span className="ml-1 text-xs text-muted-foreground">(not available yet)</span>
                </TableCell>
                <TableCell className="text-right">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  )
}
