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
import { useInsightsMetrics } from "@/lib/observability/useInsightsMetrics"
import { useGitHubMetrics } from "@/lib/observability/useGitHubMetrics"
import { cn } from "@/lib/utils"
import type { OpsMetricsPayload } from "@/lib/observability/ops-metrics"
import type { GitHubMetricsSnapshot, TopRouteRow, HotRouteRow, RateLimitEventRow } from "@/lib/observability/github-metrics"

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

function formatTimeHMS(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
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

function GitHubApiUsageCard() {
  const { data, isLoading, error, isValidating } = useGitHubMetrics()
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000))
  const err = error as (Error & { status?: number }) | undefined
  const is401 = err?.status === 401

  React.useEffect(() => {
    if (!data?.lastSeen?.reset) return
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [data?.lastSeen?.reset])

  if (isLoading && !data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-4">
        <div
          className={cn(
            "rounded-md px-2 py-1.5 text-sm",
            is401 ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"
          )}
        >
          {is401 ? "Authentication required" : err?.message ?? "Failed to load"}
        </div>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Card>
    )
  }

  const snap = data
  const w5 = snap.window5m
  const w60 = snap.window60m
  const last = snap.lastSeen
  const secondsUntilReset =
    last.reset != null ? Math.max(0, last.reset - now) : null
  const remainingPct =
    last.remaining != null && last.limit != null && last.limit > 0
      ? (last.remaining / last.limit) * 100
      : null
  const remainingClass =
    remainingPct == null
      ? ""
      : remainingPct < 10
        ? "text-destructive font-medium"
        : remainingPct < 25
          ? "text-amber-600 dark:text-amber-500 font-medium"
          : ""

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>In-memory. Resets on deploy/restart.</span>
        {isValidating && <span>Updating…</span>}
      </div>

      <div className="mt-4 space-y-4">
        {/* Usage: 5m + 60m in one block */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Usage
            </p>
            {snap.rateLimitBurst5m && (
              <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                Rate-limit pressure
              </span>
            )}
          </div>
          <div className="mt-1 space-y-0.5 text-sm">
            <p>
              <span className="text-muted-foreground">5m:</span>{" "}
              Calls <span className="font-semibold tabular-nums">{w5.calls}</span>
              {" · "}
              Rate limited{" "}
              <span className={cn("font-semibold tabular-nums", w5.rateLimited > 0 && "text-destructive")}>
                {w5.rateLimited}
              </span>
              {" · "}
              Fetch errors <span className="font-semibold tabular-nums">{w5.fetchError}</span>
            </p>
            <p>
              <span className="text-muted-foreground">60m:</span>{" "}
              Calls <span className="font-semibold tabular-nums">{w60.calls}</span>
              {" · "}
              Success <span className="font-semibold tabular-nums">{w60.success}</span>
              {" · "}
              Client <span className="font-semibold tabular-nums">{w60.clientError}</span>
              {" · "}
              Server <span className="font-semibold tabular-nums">{w60.serverError}</span>
            </p>
          </div>
        </div>

        {/* Rate limit with visual bar */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Rate limit
          </p>
          {last.remaining != null && last.limit != null && last.limit > 0 && (
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              title={`${last.remaining} / ${last.limit} remaining`}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-colors",
                  remainingPct != null && remainingPct < 10
                    ? "bg-destructive"
                    : remainingPct != null && remainingPct < 25
                      ? "bg-amber-500"
                      : "bg-primary"
                )}
                style={{
                  width: `${Math.min(100, ((last.limit - last.remaining) / last.limit) * 100)}%`,
                }}
              />
            </div>
          )}
          <p className="mt-1 text-sm">
            <span className={cn(remainingClass)}>
              {last.remaining != null && last.limit != null
                ? `${last.remaining} / ${last.limit} remaining`
                : "No data yet"}
            </span>
            {secondsUntilReset != null && (
              <span className="ml-2 text-muted-foreground">
                Resets in {secondsUntilReset}s
              </span>
            )}
          </p>
          {last.observedAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Observed {formatTime(last.observedAt)}
            </p>
          )}
        </div>

        <hr className="border-muted" />

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Hot routes (5m)
          </p>
          {Array.isArray(snap.hotRoutes5m) && snap.hotRoutes5m.length > 0 ? (
            <div className="mt-1 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead className="w-20 text-right">Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snap.hotRoutes5m.slice(0, 5).map((row: HotRouteRow, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <span className="break-all">{row.route}</span>
                        {row.rateLimited > 0 && (
                          <span className="ml-2 text-destructive">
                            ({row.rateLimited} rate-limited)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {row.calls}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">No data yet.</p>
          )}
        </div>

        {Array.isArray(snap.topRoutes60m) && snap.topRoutes60m.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Top routes (60m)
            </p>
            <div className="mt-1 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead className="w-20 text-right">Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snap.topRoutes60m.slice(0, 8).map((row: TopRouteRow, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <span className="break-all">{row.route}</span>
                        {row.rateLimited > 0 && (
                          <span className="ml-2 text-destructive">
                            ({row.rateLimited} rate-limited)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {row.calls}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Last rate-limit events
          </p>
          {!Array.isArray(snap.rateLimitEvents) || snap.rateLimitEvents.length === 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              None in memory.
            </p>
          ) : (
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {snap.rateLimitEvents.slice(0, 10).map((ev: RateLimitEventRow, i: number) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono">{formatTimeHMS(ev.at)}</span>
                  <span>status {ev.status}</span>
                  {ev.kindGuess && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                      {ev.kindGuess}
                    </span>
                  )}
                  <code className="break-all">{ev.route}</code>
                  {(ev.remaining != null || ev.limit != null) && (
                    <span>{ev.remaining ?? "—"} / {ev.limit ?? "—"}</span>
                  )}
                  {ev.reset != null && (
                    <span>reset in {Math.max(0, ev.reset - Math.floor(Date.now() / 1000))}s</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

export function InsightsDashboard() {
  const { metrics, isLoading, error, isValidating } = useInsightsMetrics()

  if (error) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      </div>
    )
  }

  if (isLoading && !metrics) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-muted-foreground">Loading metrics…</p>
      </div>
    )
  }

  const m = metrics as OpsMetricsPayload | null
  const total = m?.total ?? 0

  return (
    <div className="container mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-muted-foreground">Platform metrics (cached ~60s)</p>
      </header>

      {/* GitHub API Usage */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">GitHub API Usage</h2>
        <GitHubApiUsageCard />
      </section>

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
        <Card className="overflow-hidden py-0">
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
        <Card className="overflow-hidden py-0">
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
        <Card className="overflow-hidden py-0">
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
                <TableCell>Created → Plan ready</TableCell>
                <TableCell className="text-right">
                  {m?.avgCreatedToPlanReadySecondsLast7d != null
                    ? `${m.avgCreatedToPlanReadySecondsLast7d}s`
                    : "—"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  )
}
