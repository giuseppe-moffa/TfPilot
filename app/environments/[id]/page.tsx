"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, Loader2, Plus, RefreshCw, Rocket, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getNewRequestGate } from "@/lib/new-request-gate"

type Environment = {
  environment_id: string
  project_key: string
  repo_full_name: string
  environment_key: string
  environment_slug: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

type DeployStatusState = {
  deployed?: boolean
  deployPrOpen?: boolean | null
  error?: string
  deployPrUrl?: string
}

function formatActivityLabel(type: string): string {
  const labels: Record<string, string> = {
    environment_deployed: "Deployed",
    environment_deploy_pr_open: "Deploy PR opened",
    request_created: "Request created",
    plan_succeeded: "Plan succeeded",
    plan_failed: "Plan failed",
    apply_succeeded: "Apply succeeded",
    apply_failed: "Apply failed",
    destroy_succeeded: "Destroy succeeded",
    destroy_failed: "Destroy failed",
  }
  return labels[type] ?? type
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
  return d.toLocaleDateString()
}

function EnvironmentDetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="mb-4">
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
      </div>
      <section className="rounded-lg bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-6 w-48 animate-pulse rounded bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-1 h-4 w-64 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-4 border-t border-border/50 dark:border-slate-800/50 pt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[...Array(5)].map((_, i) => (
              <div key={i}>
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-4 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="pt-4 border-t border-border/50 dark:border-slate-800/50 mt-4">
          <div className="h-4 w-32 animate-pulse rounded bg-muted mb-2" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="pt-4 border-t border-border/50 dark:border-slate-800/50 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-9 w-24 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function EnvironmentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string | undefined
  const [env, setEnv] = React.useState<Environment | null>(null)
  const [deployStatus, setDeployStatus] = React.useState<DeployStatusState | null>(null)
  const [deploying, setDeploying] = React.useState(false)
  const [deploySuccess, setDeploySuccess] = React.useState<string | null>(null)
  const [deployError, setDeployError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [destroying, setDestroying] = React.useState(false)
  const [destroyError, setDestroyError] = React.useState<string | null>(null)
  const [drifting, setDrifting] = React.useState(false)
  const [driftError, setDriftError] = React.useState<string | null>(null)
  const [lastDrift, setLastDrift] = React.useState<{ runId: number; url: string; status: string; conclusion: string | null; createdAt: string | null } | null>(null)
  const [activity, setActivity] = React.useState<Array<{ type: string; timestamp: string; request_id?: string; module?: string; pr_url?: string }>>([])

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/environments/${id}`)
      .then((res) => (res.ok ? res.json() : { error: res.status === 404 ? "Not found" : "Failed" }))
      .then((data: { environment?: Environment; deployed?: boolean; deployPrOpen?: boolean | null; error?: string; deployPrUrl?: string }) => {
        if (cancelled) return
        if (data.environment) {
          setEnv(data.environment)
          setDeployStatus({ deployed: data.deployed, deployPrOpen: data.deployPrOpen, error: data.error, deployPrUrl: data.deployPrUrl })
          setError(null)
        } else {
          setError(data.error ?? "Failed to load")
        }
      })
      .catch(() => { if (!cancelled) setError("Failed to load") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  React.useEffect(() => {
    if (!id) return
    fetch(`/api/environments/${id}/drift-latest`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: { drift?: { runId: number; url: string; status: string; conclusion: string | null; createdAt: string | null } }) => {
        if (data?.drift) setLastDrift(data.drift)
      })
      .catch(() => {})
  }, [id])

  React.useEffect(() => {
    if (!id) return
    fetch(`/api/environments/${id}/activity`)
      .then((res) => (res.ok ? res.json() : { activity: [] }))
      .then((data: { activity?: Array<{ type: string; timestamp: string; request_id?: string; module?: string; pr_url?: string }> }) => {
        setActivity(data?.activity ?? [])
      })
      .catch(() => setActivity([]))
  }, [id])

  const handleDestroy = async () => {
    if (!id || !env || env.archived_at) return
    if (!confirm(`Destroy environment ${env.environment_key}/${env.environment_slug}? This will run terraform destroy and archive the environment.`)) return
    setDestroying(true)
    setDestroyError(null)
    try {
      const res = await fetch(`/api/environments/${id}/destroy`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDestroyError(data?.error ?? "Destroy failed")
        return
      }
      router.refresh()
      if (data?.alreadyArchived || data?.message?.includes("reconciled")) {
        const refetch = await fetch(`/api/environments/${id}`)
        const refetchData = refetch.ok ? await refetch.json().catch(() => ({})) : {}
        if (refetchData?.environment) setEnv(refetchData.environment)
      } else {
        setEnv((e) => (e ? { ...e, archived_at: "pending" } : null))
      }
    } finally {
      setDestroying(false)
    }
  }

  const handleDriftPlan = async () => {
    if (!id || !env || env.archived_at) return
    setDrifting(true)
    setDriftError(null)
    try {
      const res = await fetch("/api/github/drift-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment_id: id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDriftError(data?.error ?? "Drift plan failed")
        return
      }
      if (data?.runId && data?.url) {
        setLastDrift({
          runId: data.runId,
          url: data.url,
          status: "in_progress",
          conclusion: null,
          createdAt: new Date().toISOString(),
        })
      }
    } finally {
      setDrifting(false)
    }
  }

  const refetchEnv = React.useCallback(async () => {
    if (!id) return
    setDeploySuccess(null)
    setDeployError(null)
    const res = await fetch(`/api/environments/${id}`)
    const data = res.ok ? await res.json().catch(() => ({})) : {}
    if (data.environment) {
      setEnv(data.environment)
      setDeployStatus({ deployed: data.deployed, deployPrOpen: data.deployPrOpen, error: data.error, deployPrUrl: data.deployPrUrl })
    }
  }, [id])

  React.useEffect(() => {
    if (!id) return
    const shouldPoll =
      deployStatus?.deployPrOpen === true &&
      deployStatus?.deployed !== true &&
      deployStatus?.error !== "ENV_DEPLOY_CHECK_FAILED"
    if (!shouldPoll) return
    const interval = setInterval(refetchEnv, 12_000)
    return () => clearInterval(interval)
  }, [id, deployStatus?.deployPrOpen, deployStatus?.deployed, deployStatus?.error, refetchEnv])

  const handleDeploy = async () => {
    if (!id || !env || env.archived_at) return
    setDeploying(true)
    setDeploySuccess(null)
    setDeployError(null)
    try {
      const res = await fetch(`/api/environments/${id}/deploy`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setDeploySuccess("Deploy PR created")
        setDeployStatus((s) => (s ? { ...s, deployPrOpen: true, deployPrUrl: data?.deploy?.pr_url ?? s.deployPrUrl } : { deployPrOpen: true, deployPrUrl: data?.deploy?.pr_url }))
        await refetchEnv()
      } else if (res.status === 409) {
        await refetchEnv()
        if (data?.error === "ENV_DEPLOY_IN_PROGRESS") {
          setDeployError("Deploy already in progress")
        }
      } else if (res.status === 503 && data?.error === "ENV_DEPLOY_CHECK_FAILED") {
        setDeployError("Cannot verify deploy status")
        await refetchEnv()
      } else {
        setDeployError(data?.error ?? "Deploy failed")
      }
    } finally {
      setDeploying(false)
    }
  }

  if (loading) {
    return <EnvironmentDetailSkeleton />
  }

  if (error || !env) {
    return (
      <div className="mx-auto max-w-7xl space-y-8">
        <p className="text-destructive">{error ?? "Environment not found"}</p>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/environments" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to environments
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/environments" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </Button>

      {!env.archived_at && deployStatus && (
        <section className="rounded-lg border bg-muted/30 dark:bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {deployStatus.error === "ENV_DEPLOY_CHECK_FAILED" ? (
              <>
                <Badge variant="outline" className="text-amber-600 dark:text-amber-500 border-amber-300 dark:border-amber-600">Cannot verify</Badge>
                <span className="text-sm text-muted-foreground">Cannot verify deploy status</span>
                <Button variant="outline" size="sm" onClick={refetchEnv} className="gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              </>
            ) : deployStatus.deployPrOpen ? (
              <>
                <Badge variant="outline" className="text-amber-600 dark:text-amber-500 border-amber-300 dark:border-amber-600">Deploying</Badge>
                <span className="text-sm text-muted-foreground">Environment deployment in progress</span>
                {deployStatus.deployPrUrl ? (
                  <a href={deployStatus.deployPrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    View deploy PR
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">Deploying…</span>
                )}
              </>
            ) : deployStatus.deployed ? (
              <>
                <Badge variant="outline" className="text-emerald-600 dark:text-emerald-500 border-emerald-300 dark:border-emerald-600">Deployed</Badge>
                <span className="text-sm text-muted-foreground">Environment is deployed</span>
                <Button variant="default" size="sm" asChild className="gap-1">
                  <Link href={`/requests/new?environmentId=${env.environment_id}`}>
                    <Plus className="h-3 w-3" />
                    New request
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-muted-foreground">Not deployed</Badge>
                <span className="text-sm text-muted-foreground">Environment must be deployed before creating resources</span>
                <Button variant="default" size="sm" onClick={handleDeploy} disabled={deploying} className="gap-1">
                  {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Deploy environment
                </Button>
              </>
            )}
          </div>
          {(deploySuccess || deployError) && (
            <p className={`mt-2 text-sm ${deployError ? "text-destructive" : "text-emerald-600 dark:text-emerald-500"}`}>
              {deployError ?? deploySuccess}
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold leading-none">
            {env.project_key} · {env.environment_key} / {env.environment_slug}
          </h1>
          {env.archived_at ? (
            <Badge variant="secondary">Archived</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{env.repo_full_name}</p>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-6">
          <div>
            <dt className="text-muted-foreground">Project</dt>
            <dd>{env.project_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Environment key</dt>
            <dd>{env.environment_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{env.environment_slug}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Repo</dt>
            <dd>{env.repo_full_name}</dd>
          </div>
          {env.archived_at ? (
            <div>
              <dt className="text-muted-foreground">Archived</dt>
              <dd className="text-amber-600">{new Date(env.archived_at).toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>

        {lastDrift && (
          <div className="pt-4 border-t mt-4">
            <h4 className="text-sm font-medium mb-1">Last drift plan</h4>
            <div className="flex items-center gap-2 text-sm">
              <span className={lastDrift.conclusion === "success" ? "text-green-600" : lastDrift.conclusion === "failure" ? "text-destructive" : "text-muted-foreground"}>
                {lastDrift.status === "in_progress" || lastDrift.status === "queued" ? "Running…" : lastDrift.conclusion ?? lastDrift.status}
              </span>
              {lastDrift.createdAt && (
                <span className="text-muted-foreground">{new Date(lastDrift.createdAt).toLocaleString()}</span>
              )}
              <a href={lastDrift.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                View run
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        <div className="pt-4 border-t mt-4">
          <h4 className="text-sm font-medium mb-2">Environment Activity</h4>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(activity.slice(0, 20)).map((evt, i) => (
                <li key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground shrink-0">
                    {formatActivityLabel(evt.type)}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatRelativeTime(evt.timestamp)}
                  </span>
                  {evt.request_id && (
                    <Link href={`/requests/${evt.request_id}`} className="text-primary hover:underline">
                      {evt.module ? `${evt.module} · ` : ""}{evt.request_id.slice(0, 8)}
                    </Link>
                  )}
                  {evt.pr_url && !evt.request_id && (
                    <a href={evt.pr_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      Deploy PR
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!env.archived_at && (
          <div className="pt-4 border-t mt-4 space-y-3">
            {(() => {
              const gate = getNewRequestGate(deployStatus ?? { error: "ENV_DEPLOY_CHECK_FAILED" })
              return (
                <div className="flex flex-col gap-2">
                  {gate.allowed ? (
                    <Button variant="default" asChild className="gap-2 w-fit">
                      <Link href={`/requests/new?environmentId=${env.environment_id}`}>
                        <Plus className="h-4 w-4" />
                        New Request
                      </Link>
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" disabled className="gap-2 w-fit">
                        <Plus className="h-4 w-4" />
                        New Request
                      </Button>
                      <span className="text-sm text-muted-foreground">{gate.message}</span>
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleDriftPlan}
                disabled={drifting}
                className="gap-2"
              >
                {drifting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Drift plan
              </Button>
              <Button
                variant="destructive"
                onClick={handleDestroy}
                disabled={destroying}
                className="gap-2"
              >
                {destroying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Destroy environment
              </Button>
            </div>
            {(driftError || destroyError) && (
              <p className="text-sm text-destructive">{driftError ?? destroyError}</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
