/**
 * Bootstrap PR for Model 2 Workspaces.
 * Creates envs/<key>/<slug>/ with backend.tf, providers.tf, versions.tf, tfpilot/base.tf, tfpilot/requests/.gitkeep.
 * PR-native: no direct pushes to main. envs/ path convention intentionally preserved.
 */

import { gh, ghResponse } from "@/lib/github/client"
import { computeWorkspaceRoot } from "@/lib/workspaces/helpers"

export type BootstrapTarget = {
  owner: string
  repo: string
  base: string
}

export type BootstrapResult = {
  workspace: { workspace_id: string; workspace_key: string; workspace_slug: string }
  prNumber: number
  prUrl: string
  branchName: string
  commitSha: string
  alreadyBootstrapped?: boolean
}

/** Check if backend.tf exists at env root on base branch. */
async function checkPathExists(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<boolean> {
  const res = await ghResponse(
    token,
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
  )
  return res.ok
}

function backendTfContent(): string {
  return `terraform {
  backend "s3" {}
}
`
}

function providersTfContent(project_key: string, workspace_key: string): string {
  return `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "tfpilot"
      Project     = "${project_key}"
      Environment = "${workspace_key}"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for this environment"
  default     = "eu-west-2"
}
`
}

function versionsTfContent(): string {
  return `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
`
}

function tfpilotBaseTfContent(): string {
  return `# Model 2 workspace root. Request files go in tfpilot/requests/
`
}

/**
 * Create bootstrap PR for a workspace.
 * If env root already exists on base branch, returns alreadyBootstrapped and does not create PR.
 */
export async function createBootstrapPr(
  token: string,
  target: BootstrapTarget,
  params: {
    workspace_id: string
    project_key: string
    workspace_key: string
    workspace_slug: string
  }
): Promise<BootstrapResult> {
  const wsId = params.workspace_id
  const wsKey = params.workspace_key
  const wsSlug = params.workspace_slug
  const envRoot = computeWorkspaceRoot(wsKey, wsSlug)
  const backendPath = `${envRoot}/backend.tf`
  const alreadyExists = await checkPathExists(token, target.owner, target.repo, backendPath, target.base)
  if (alreadyExists) {
    const wsObj = { workspace_id: wsId, workspace_key: wsKey, workspace_slug: wsSlug }
    return {
      workspace: wsObj,
      prNumber: 0,
      prUrl: "",
      branchName: "",
      commitSha: "",
      alreadyBootstrapped: true,
    }
  }

  const branchName = `bootstrap/env/${wsKey}-${wsSlug}`
  const files: Array<{ path: string; content: string }> = [
    { path: `${envRoot}/backend.tf`, content: backendTfContent() },
    { path: `${envRoot}/providers.tf`, content: providersTfContent(params.project_key, wsKey) },
    { path: `${envRoot}/versions.tf`, content: versionsTfContent() },
    { path: `${envRoot}/tfpilot/base.tf`, content: tfpilotBaseTfContent() },
    { path: `${envRoot}/tfpilot/requests/.gitkeep`, content: "" },
  ]

  const refRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/ref/heads/${target.base}`)
  const refJson = (await refRes.json()) as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) throw new Error("Failed to resolve base branch SHA")

  try {
    await gh(token, `/repos/${target.owner}/${target.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    })
  } catch (err: unknown) {
    const e = err as { status?: number }
    if (e?.status !== 422) throw err
  }

  const baseCommitRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/commits/${baseSha}`)
  const baseCommit = (await baseCommitRes.json()) as { tree?: { sha?: string } }
  const baseTreeSha = baseCommit.tree?.sha
  if (!baseTreeSha) throw new Error("Failed to resolve base tree")

  const blobs: Array<{ path: string; sha: string }> = []
  for (const file of files) {
    const blobRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    })
    const blobJson = (await blobRes.json()) as { sha?: string }
    if (!blobJson.sha) throw new Error("Failed to create blob")
    blobs.push({ path: file.path, sha: blobJson.sha })
  }

  const treeRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  })
  const treeJson = (await treeRes.json()) as { sha?: string }
  if (!treeJson.sha) throw new Error("Failed to create tree")

  const commitRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `chore: bootstrap env ${wsKey}/${wsSlug}`,
      tree: treeJson.sha,
      parents: [baseSha],
    }),
  })
  const commitJson = (await commitRes.json()) as { sha?: string }
  if (!commitJson.sha) throw new Error("Failed to create commit")

  await gh(token, `/repos/${target.owner}/${target.repo}/git/refs/heads/${branchName}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitJson.sha, force: true }),
  })

  const prRes = await gh(token, `/repos/${target.owner}/${target.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Bootstrap workspace ${wsKey}/${wsSlug}`,
      head: branchName,
      base: target.base,
      body: `Workspace bootstrap for ${params.project_key}/${wsKey}/${wsSlug}.\n\nCreates:\n- ${envRoot}/backend.tf (generic s3 backend)\n- ${envRoot}/providers.tf\n- ${envRoot}/versions.tf\n- ${envRoot}/tfpilot/base.tf\n- ${envRoot}/tfpilot/requests/.gitkeep`,
    }),
  })
  const prJson = (await prRes.json()) as { number?: number; html_url?: string }
  if (!prJson.number || !prJson.html_url) throw new Error("Failed to open PR")

  const wsObj = { workspace_id: wsId, workspace_key: wsKey, workspace_slug: wsSlug }
  return {
    workspace: wsObj,
    prNumber: prJson.number,
    prUrl: prJson.html_url,
    branchName,
    commitSha: commitJson.sha,
  }
}
