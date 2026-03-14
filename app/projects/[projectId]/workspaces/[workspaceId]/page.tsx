"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ExternalLink, Loader2, Plus, RefreshCw, Rocket, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
type Workspace = {
  workspace_id: string
  project_key: string
  repo_full_name: string
  workspace_key: string
  workspace_slug: string
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
    workspace_deployed: "Deployed",
    workspace_deploy_pr_open: "Deploy PR opened",
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
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
  return d.toLocaleDateString()
}

function WorkspaceDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        <div className="flex flex-col gap-4 px-6 py-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[...Array(4)].map((_, i) => (
              <div key={i}>
                <div className="h-3 w-20 animate-pulse bg-muted" />
                <div className="mt-1 h-4 w-28 animate-pulse bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function WorkspaceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params?.projectId as string | undefined
  const workspaceId = params?.workspaceId as string | undefined

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
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
  const [lastDrift, setLastDrift] = React.useState<{
    runId: number
    url: string
    status: string
    conclusion: string | null
    createdAt: string | null
  } | null>(null)
  const [activity, setActivity] = React.useState<
    Array<{ type: string; timestamp: string; request_id?: string; module?: string; pr_url?: string }>
  >([])
  const [projectName, setProjectName] = React.useState<string | null>(null)
  const [projectDefaultBranch, setProjectDefaultBranch] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}`)
      .then((res) =>
        res.ok ? res.json() : { error: res.status === 404 ? "Not found" : "Failed" }
      )
      .then(
        (data: {
          workspace?: Workspace
          deployed?: boolean
          deployPrOpen?: boolean | null
          error?: string
          deployPrUrl?: string
        }) => {
          if (cancelled) return
          if (data.workspace) {
            setWorkspace(data.workspace)
            setDeployStatus({
              deployed: data.deployed,
              deployPrOpen: data.deployPrOpen,
              error: data.error,
              deployPrUrl: data.deployPrUrl,
            })
            setError(null)
          } else {
            setError(data.error ?? "Failed to load")
          }
        }
      )
      .catch(() => {
        if (!cancelled) setError("Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  React.useEffect(() => {
    const key = (workspace?.project_key ?? projectId ?? "").trim()
    if (!key) return
    let cancelled = false
    fetch(`/api/projects/${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { project?: { name?: string; default_branch?: string } } | null) => {
        if (cancelled || !data?.project) return
        setProjectName(data.project.name ?? null)
        setProjectDefaultBranch(data.project.default_branch ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspace?.project_key, projectId])

  React.useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/workspaces/${workspaceId}/drift-latest`)
      .then((res) => (res.ok ? res.json() : {}))
      .then(
        (data: {
          drift?: {
            runId: number
            url: string
            status: string
            conclusion: string | null
            createdAt: string | null
          }
        }) => {
          if (data?.drift) setLastDrift(data.drift)
        }
      )
      .catch(() => {})
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/workspaces/${workspaceId}/activity`)
      .then((res) => (res.ok ? res.json() : { activity: [] }))
      .then(
        (data: {
          activity?: Array<{
            type: string
            timestamp: string
            request_id?: string
            module?: string
            pr_url?: string
          }>
        }) => {
          setActivity(data?.activity ?? [])
        }
      )
      .catch(() => setActivity([]))
  }, [workspaceId])

  const refetchWorkspace = React.useCallback(async () => {
    if (!workspaceId) return
    setDeploySuccess(null)
    setDeployError(null)
    const res = await fetch(`/api/workspaces/${workspaceId}`)
    const data = res.ok ? await res.json().catch(() => ({})) : {}
    if (data.workspace) {
      setWorkspace(data.workspace)
      setDeployStatus({
        deployed: data.deployed,
        deployPrOpen: data.deployPrOpen,
        error: data.error,
        deployPrUrl: data.deployPrUrl,
      })
    }
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    const shouldPoll =
      deployStatus?.deployPrOpen === true &&
      deployStatus?.deployed !== true &&
      deployStatus?.error !== "WORKSPACE_DEPLOY_CHECK_FAILED" &&
      deployStatus?.error !== "ENV_DEPLOY_CHECK_FAILED"
    if (!shouldPoll) return
    const interval = setInterval(refetchWorkspace, 12_000)
    return () => clearInterval(interval)
  }, [workspaceId, deployStatus?.deployPrOpen, deployStatus?.deployed, deployStatus?.error, refetchWorkspace])

  const handleDeploy = async () => {
    if (!workspaceId || !workspace || workspace.archived_at) return
    setDeploying(true)
    setDeploySuccess(null)
    setDeployError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/deploy`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setDeploySuccess("Deploy PR created")
        setDeployStatus((s) => ({
          ...(s ?? {}),
          deployPrOpen: true,
          deployPrUrl: data?.deploy?.pr_url ?? s?.deployPrUrl,
        }))
        await refetchWorkspace()
      } else if (res.status === 409) {
        await refetchWorkspace()
        if (data?.error === "WORKSPACE_DEPLOY_IN_PROGRESS" || data?.error === "ENV_DEPLOY_IN_PROGRESS") {
          setDeployError("Deploy already in progress")
        }
      } else if (
        res.status === 503 &&
        (data?.error === "WORKSPACE_DEPLOY_CHECK_FAILED" || data?.error === "ENV_DEPLOY_CHECK_FAILED")
      ) {
        setDeployError("Cannot verify deploy status")
        await refetchWorkspace()
      } else {
        setDeployError(data?.error ?? "Deploy failed")
      }
    } finally {
      setDeploying(false)
    }
  }

  const handleDestroy = async () => {
    if (!workspaceId || !workspace || workspace.archived_at) return
    if (
      !confirm(
        `Destroy workspace ${workspace.workspace_key}/${workspace.workspace_slug}? This will run terraform destroy and archive the workspace.`
      )
    )
      return
    setDestroying(true)
    setDestroyError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/destroy`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDestroyError(data?.error ?? "Destroy failed")
        return
      }
      router.refresh()
      if (data?.alreadyArchived || data?.message?.includes("reconciled")) {
        const refetch = await fetch(`/api/workspaces/${workspaceId}`)
        const refetchData = refetch.ok ? await refetch.json().catch(() => ({})) : {}
        if (refetchData?.workspace) setWorkspace(refetchData.workspace)
      } else {
        setWorkspace((w) => (w ? { ...w, archived_at: "pending" } : null))
      }
    } finally {
      setDestroying(false)
    }
  }

  const handleDriftPlan = async () => {
    if (!workspaceId || !workspace || workspace.archived_at) return
    setDrifting(true)
    setDriftError(null)
    try {
      const res = await fetch("/api/github/drift-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
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

  if (loading) return <WorkspaceDetailSkeleton />

  if (error || !workspace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <p className="text-destructive">{error ?? "Workspace not found"}</p>
      </div>
    )
  }

  const deployCheckFailed =
    deployStatus?.error === "WORKSPACE_DEPLOY_CHECK_FAILED" ||
    deployStatus?.error === "ENV_DEPLOY_CHECK_FAILED"

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <Card className="flex min-h-0 flex-1 flex-col pt-0">
        {!workspace.archived_at && deployStatus && (
          <div className="border-b border-border bg-muted/30 dark:bg-muted/20 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {deployCheckFailed ? (
                <>
                  <Badge
                    variant="outline"
                    className="text-amber-600 dark:text-amber-500 border-amber-300 dark:border-amber-600"
                  >
                    Cannot verify
                  </Badge>
                  <span className="text-sm text-muted-foreground">Cannot verify deploy status</span>
                </>
              ) : deployStatus.deployPrOpen ? (
                <>
                  <Badge
                    variant="outline"
                    className="text-amber-600 dark:text-amber-500 border-amber-300 dark:border-amber-600"
                  >
                    Deploying
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Workspace deployment in progress
                  </span>
                  {deployStatus.deployPrUrl ? (
                    <a
                      href={deployStatus.deployPrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      View deploy PR
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">Deploying…</span>
                  )}
                </>
              ) : deployStatus.deployed ? (
                <>
                  <Badge
                    variant="outline"
                    className="text-emerald-600 dark:text-emerald-500 border-emerald-300 dark:border-emerald-600"
                  >
                    Deployed
                  </Badge>
                  <span className="text-sm text-muted-foreground">Workspace is deployed</span>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="text-muted-foreground">
                    Not deployed
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Workspace must be deployed before creating resources
                  </span>
                </>
              )}
            </div>
            <div className="shrink-0">
              {deployCheckFailed ? (
                <Button variant="outline" size="sm" onClick={refetchWorkspace} className="gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              ) : deployStatus.deployPrOpen ? null : deployStatus.deployed ? (
                <Button variant="default" size="sm" asChild className="gap-1">
                  <Link href={`/requests/new?workspaceId=${workspace.workspace_id}`}>
                    <Plus className="h-3 w-3" />
                    New request
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="gap-1"
                >
                  {deploying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Rocket className="h-3 w-3" />
                  )}
                  Deploy workspace
                </Button>
              )}
            </div>
          </div>
          {(deploySuccess || deployError) && (
            <p
              className={`mt-2 text-sm ${deployError ? "text-destructive" : "text-emerald-600 dark:text-emerald-500"}`}
            >
              {deployError ?? deploySuccess}
            </p>
          )}
          </div>
        )}

        <div className="flex flex-col gap-4 px-6 py-6">
          <div className="flex items-center gap-2 flex-wrap">
            {workspace.archived_at ? <Badge variant="secondary">Archived</Badge> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Project</dt>
            <dd>{projectName ?? workspace.project_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Environment</dt>
            <dd>{workspace.workspace_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{workspace.workspace_slug}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Repo</dt>
            <dd>{workspace.repo_full_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Path</dt>
            <dd>
              {(() => {
                const path = `envs/${workspace.workspace_key}/${workspace.workspace_slug}`
                const [owner, repo] = workspace.repo_full_name.split("/")
                const branch = projectDefaultBranch?.trim() || "main"
                const href =
                  owner && repo
                    ? `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
                    : null
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {path}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="font-mono text-sm">{path}</span>
                )
              })()}
            </dd>
          </div>
          {workspace.archived_at ? (
            <div>
              <dt className="text-muted-foreground">Archived</dt>
              <dd className="text-amber-600">{new Date(workspace.archived_at).toLocaleString()}</dd>
            </div>
          ) : null}
          </dl>

          {lastDrift && (
            <div className="pt-4 border-t border-border">
            <h4 className="text-sm font-medium mb-1">Last drift plan</h4>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={
                  lastDrift.conclusion === "success"
                    ? "text-green-600"
                    : lastDrift.conclusion === "failure"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {lastDrift.status === "in_progress" || lastDrift.status === "queued"
                  ? "Running…"
                  : lastDrift.conclusion ?? lastDrift.status}
              </span>
              {lastDrift.createdAt && (
                <span className="text-muted-foreground">
                  {new Date(lastDrift.createdAt).toLocaleString()}
                </span>
              )}
              <a
                href={lastDrift.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                View run
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          )}

          <div className="pt-4 border-t border-border">
            <h4 className="text-sm font-medium mb-2">Workspace Activity</h4>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {activity.slice(0, 20).map((evt, i) => (
                <li key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground shrink-0">
                    {formatActivityLabel(evt.type)}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatRelativeTime(evt.timestamp)}
                  </span>
                  {evt.request_id && (
                    <Link
                      href={`/requests/${evt.request_id}`}
                      className="text-primary hover:underline"
                    >
                      {evt.module ? `${evt.module} · ` : ""}
                      {evt.request_id.slice(0, 8)}
                    </Link>
                  )}
                  {evt.pr_url && !evt.request_id && (
                    <a
                      href={evt.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Deploy PR
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!workspace.archived_at && deployStatus?.deployed && (
          <div className="pt-4 border-t border-border space-y-3">
            <Button variant="default" asChild className="gap-2 w-fit">
              <Link href={`/requests/new?workspaceId=${workspace.workspace_id}`}>
                <Plus className="h-4 w-4" />
                New Request
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleDriftPlan}
                disabled={drifting}
                className="gap-2"
              >
                {drifting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
                Destroy workspace
              </Button>
            </div>
            {(driftError || destroyError) && (
              <p className="text-sm text-destructive">{driftError ?? destroyError}</p>
            )}
          </div>
        )}
        </div>
      </Card>
    </div>
  )
}
