/**
 * Unit tests: createDeployPR.
 * Phase 5 — Chunk 5.3. Rollback order and behavior.
 */

import {
  createDeployPR,
  DeployBranchExistsError,
  type CreateDeployPROptions,
} from "@/lib/github/createDeployPR"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(data),
  } as Response
}

const BASE_PARAMS = {
  owner: "owner",
  repo: "repo",
  base: "main",
  branchName: "deploy/dev/ai-agent",
  files: [{ path: "envs/dev/ai-agent/backend.tf", content: "terraform {}" }],
  commitMessage: "chore: deploy",
  prTitle: "Deploy",
  prBody: "Body",
}

type GhLike = (token: string, path: string, init?: RequestInit) => Promise<Response>
type GhResponseLike = (token: string, path: string, init?: RequestInit) => Promise<Response>

function createMockGh(config: {
  failAtPulls?: boolean
  failAtBranchCreate?: boolean
  failAtDelete?: boolean
  revertCalled?: { current: boolean }
}): GhLike {
  return async (_token, path, init) => {
    const method = (init as RequestInit)?.method ?? "GET"
    if (config.failAtBranchCreate && path.includes("/git/refs") && method === "POST") {
      throw new Error("Branch create failed")
    }
    if (config.failAtPulls && path.includes("/pulls")) {
      throw new Error("PR failed")
    }
    if (config.failAtDelete && method === "DELETE" && config.revertCalled?.current) {
      throw new Error("Branch delete failed")
    }
    if (path.includes("/git/ref/")) {
      return mockResponse({ object: { sha: "basesha40chars123456789012345678" } })
    }
    if (path.includes("/git/refs") && method === "POST") {
      return mockResponse({ ref: "refs/heads/deploy/dev/ai-agent", object: { sha: "basesha40chars123456789012345678" } })
    }
    if (path.includes("/git/commits/") && method === "GET") {
      return mockResponse({ tree: { sha: "basetreesha40chars12345678901234" } })
    }
    if (path.includes("/git/blobs") && method === "POST") {
      return mockResponse({ sha: "blobsha40chars12345678901234567890123" })
    }
    if (path.includes("/git/trees") && method === "POST") {
      return mockResponse({ sha: "treesha40chars12345678901234567890123" })
    }
    if (path.includes("/git/commits") && method === "POST") {
      return mockResponse({ sha: "commitsha40chars12345678901234567890" })
    }
    if (path.includes("/git/refs/") && method === "PATCH") {
      return mockResponse({ object: { sha: "commitsha40chars12345678901234567890" } })
    }
    if (path.includes("/pulls")) {
      return mockResponse({ number: 1, html_url: "https://github.com/owner/repo/pull/1" })
    }
    if (method === "DELETE") {
      return mockResponse({}, true)
    }
    return mockResponse({})
  }
}

function createMockGhResponse(): GhResponseLike {
  return async () => mockResponse({}, false)
}

export const tests = [
  {
    name: "DeployBranchExistsError: has correct message",
    fn: () => {
      const err = new DeployBranchExistsError("deploy/dev/ai-agent")
      assert(err.message.includes("deploy/dev/ai-agent"), "message includes branch name")
      assert(err instanceof DeployBranchExistsError, "instanceof")
    },
  },
  {
    name: "createDeployPR: PR failure after commit — rollback runs revert_files then delete_branch",
    fn: async () => {
      const steps: string[] = []
      const options: CreateDeployPROptions = {
        onRollbackStep: (step) => steps.push(step),
        ghOverride: createMockGh({ failAtPulls: true }) as typeof import("@/lib/github/client").gh,
        ghResponseOverride: createMockGhResponse() as typeof import("@/lib/github/client").ghResponse,
      }
      try {
        await createDeployPR("token", BASE_PARAMS, options)
      } catch {
        // expected
      }
      assert(steps.length === 2, `expected 2 rollback steps, got ${steps.length}: ${steps.join(",")}`)
      assert(steps[0] === "revert_files", `first step must be revert_files, got ${steps[0]}`)
      assert(steps[1] === "delete_branch", `second step must be delete_branch, got ${steps[1]}`)
    },
  },
  {
    name: "createDeployPR: rollback does not run when no branch was created",
    fn: async () => {
      const steps: string[] = []
      const options: CreateDeployPROptions = {
        onRollbackStep: (step) => steps.push(step),
        ghOverride: createMockGh({ failAtBranchCreate: true }) as typeof import("@/lib/github/client").gh,
        ghResponseOverride: createMockGhResponse() as typeof import("@/lib/github/client").ghResponse,
      }
      try {
        await createDeployPR("token", BASE_PARAMS, options)
      } catch {
        // expected
      }
      assert(steps.length === 0, `rollback must not run when branch not created, got steps: ${steps.join(",")}`)
    },
  },
  {
    name: "createDeployPR: branch deletion failure — revert_files runs first; original error rethrown",
    fn: async () => {
      const steps: string[] = []
      const revertCalled = { current: false }
      const options: CreateDeployPROptions = {
        onRollbackStep: (step) => {
          steps.push(step)
          if (step === "revert_files") revertCalled.current = true
        },
        ghOverride: createMockGh({ failAtPulls: true, failAtDelete: true, revertCalled }) as typeof import("@/lib/github/client").gh,
        ghResponseOverride: createMockGhResponse() as typeof import("@/lib/github/client").ghResponse,
      }
      let caught: unknown
      try {
        await createDeployPR("token", BASE_PARAMS, options)
      } catch (err) {
        caught = err
      }
      assert(caught != null, "must throw")
      assert(
        (caught as Error).message === "PR failed",
        `original error must be rethrown, got ${(caught as Error).message}`
      )
      assert(steps[0] === "revert_files", "revert_files must run before delete_branch")
    },
  },
]
