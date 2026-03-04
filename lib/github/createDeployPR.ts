/**
 * Create deploy PR: branch + commit skeleton files + open PR.
 * Atomic: on failure after branch creation, rollback (1) revert files, (2) delete branch.
 */

import { gh, ghResponse } from "@/lib/github/client"
import { logWarn } from "@/lib/observability/logger"

export type CreateDeployPRParams = {
  owner: string
  repo: string
  base: string
  branchName: string
  files: Array<{ path: string; content: string }>
  commitMessage: string
  prTitle: string
  prBody: string
}

export type CreateDeployPRResult = {
  pr_number: number
  pr_url: string
  branch_name: string
  commit_sha: string
}

/** Optional test hooks. Do not use in production. */
export type CreateDeployPROptions = {
  /** When provided, called before each rollback step. Used to verify order. */
  onRollbackStep?: (step: "revert_files" | "delete_branch") => void
  /** Override gh. When provided, used instead of real gh (for testing). */
  ghOverride?: typeof gh
  /** Override ghResponse. When provided, used instead of real ghResponse (for testing). */
  ghResponseOverride?: typeof ghResponse
}

export class DeployBranchExistsError extends Error {
  constructor(branchName: string) {
    super(`Deploy branch already exists: ${branchName}`)
  }
}

type GhClients = { gh: typeof gh; ghResponse: typeof ghResponse }

/** Check if branch exists. Returns true if it does. */
async function branchExists(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  clients: GhClients
): Promise<boolean> {
  const ref = `heads/${branchName}`
  const res = await clients.ghResponse(token, `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(ref)}`)
  return res.ok
}

/** Delete branch. Swallows 404 (already gone). */
async function deleteBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  clients: GhClients
): Promise<void> {
  const ref = `heads/${branchName}`
  try {
    await clients.gh(token, `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(ref)}`, { method: "DELETE" })
  } catch (err: unknown) {
    const e = err as { status?: number }
    if (e?.status === 404) return
    throw err
  }
}

/**
 * Rollback: (1) revert files on branch via commit with base tree, (2) delete branch.
 * Failures are logged but do not mask the original error.
 */
async function rollbackDeployBranch(
  token: string,
  params: {
    owner: string
    repo: string
    branchName: string
    baseTreeSha: string
    deployCommitSha: string
  },
  clients: GhClients,
  onStep?: (step: "revert_files" | "delete_branch") => void
): Promise<void> {
  const { owner, repo, branchName, baseTreeSha, deployCommitSha } = params

  onStep?.("revert_files")
  try {
    const rollbackCommitRes = await clients.gh(token, `/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: "rollback: remove deploy files",
        tree: baseTreeSha,
        parents: [deployCommitSha],
      }),
    })
    const rollbackCommitJson = (await rollbackCommitRes.json()) as { sha?: string }
    if (rollbackCommitJson.sha) {
      const refForUpdate = `heads/${branchName}`
      await clients.gh(token, `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(refForUpdate)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: rollbackCommitJson.sha, force: true }),
      })
    }
  } catch (rollbackErr) {
    logWarn("createDeployPR.rollback.revert_files_failed", rollbackErr, {
      branch: branchName,
      owner,
      repo,
    })
  }

  onStep?.("delete_branch")
  try {
    await deleteBranch(token, owner, repo, branchName, clients)
  } catch (deleteErr) {
    logWarn("createDeployPR.rollback.delete_branch_failed", deleteErr, {
      branch: branchName,
      owner,
      repo,
    })
  }
}

/**
 * Create deploy branch, commit files, open PR.
 * Before creating: checks if branch exists → throws DeployBranchExistsError (409).
 * On any failure after branch created: rollback (1) revert files, (2) delete branch.
 */
export async function createDeployPR(
  token: string,
  params: CreateDeployPRParams,
  options?: CreateDeployPROptions
): Promise<CreateDeployPRResult> {
  const { owner, repo, base, branchName, files, commitMessage, prTitle, prBody } = params
  const clients: GhClients = {
    gh: options?.ghOverride ?? gh,
    ghResponse: options?.ghResponseOverride ?? ghResponse,
  }

  if (await branchExists(token, owner, repo, branchName, clients)) {
    throw new DeployBranchExistsError(branchName)
  }

  const refRes = await clients.gh(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`)
  const refJson = (await refRes.json()) as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) throw new Error("Failed to resolve base branch SHA")

  let branchCreated = false
  try {
    await clients.gh(token, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    })
    branchCreated = true
  } catch (err: unknown) {
    const e = err as { status?: number }
    if (e?.status === 422) throw new DeployBranchExistsError(branchName)
    throw err
  }

  let refUpdated = false
  let deployCommitSha = ""
  let baseTreeSha = ""

  try {
    const baseCommitRes = await clients.gh(token, `/repos/${owner}/${repo}/git/commits/${baseSha}`)
    const baseCommit = (await baseCommitRes.json()) as { tree?: { sha?: string } }
    baseTreeSha = baseCommit.tree?.sha ?? ""
    if (!baseTreeSha) throw new Error("Failed to resolve base tree")

    const blobs: Array<{ path: string; sha: string }> = []
    for (const file of files) {
      const blobRes = await clients.gh(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      })
      const blobJson = (await blobRes.json()) as { sha?: string }
      if (!blobJson.sha) throw new Error("Failed to create blob")
      blobs.push({ path: file.path, sha: blobJson.sha })
    }

    const treeRes = await clients.gh(token, `/repos/${owner}/${repo}/git/trees`, {
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

    const commitRes = await clients.gh(token, `/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: treeJson.sha,
        parents: [baseSha],
      }),
    })
    const commitJson = (await commitRes.json()) as { sha?: string }
    if (!commitJson.sha) throw new Error("Failed to create commit")
    deployCommitSha = commitJson.sha

    const refForUpdate = `heads/${branchName}`
    await clients.gh(token, `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(refForUpdate)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitJson.sha, force: true }),
    })
    refUpdated = true

    const prRes = await clients.gh(token, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: prTitle,
        head: branchName,
        base,
        body: prBody,
      }),
    })
    const prJson = (await prRes.json()) as { number?: number; html_url?: string }
    if (!prJson.number || !prJson.html_url) throw new Error("Failed to open PR")

    return {
      pr_number: prJson.number,
      pr_url: prJson.html_url,
      branch_name: branchName,
      commit_sha: commitJson.sha,
    }
  } catch (err) {
    if (branchCreated) {
      if (refUpdated && deployCommitSha && baseTreeSha) {
        try {
          await rollbackDeployBranch(
            token,
            { owner, repo, branchName, baseTreeSha, deployCommitSha },
            clients,
            options?.onRollbackStep
          )
        } catch (rollbackErr) {
          logWarn("createDeployPR.rollback.failed", rollbackErr, { branch: branchName, owner, repo })
        }
      } else {
        try {
          await deleteBranch(token, owner, repo, branchName, clients)
        } catch (deleteErr) {
          logWarn("createDeployPR.rollback.delete_branch_failed", deleteErr, {
            branch: branchName,
            owner,
            repo,
          })
        }
      }
    }
    throw err
  }
}
