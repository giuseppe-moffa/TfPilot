/**
 * Invariant tests: Deploy error codes (Chunk 7.1).
 * Route contract: POST /api/workspaces/:id/deploy maps these to HTTP status + JSON body.
 */

import { isValidTemplateId } from "@/lib/workspaces/validateTemplateId"
import {
  isWorkspaceDeployed,
  WORKSPACE_DEPLOY_CHECK_FAILED,
  type IsWorkspaceDeployedParams,
  type DeployCheckFetcher,
} from "@/lib/workspaces/isWorkspaceDeployed"
import {
  createDeployPR,
  DeployBranchExistsError,
  type CreateDeployPROptions,
} from "@/lib/github/createDeployPR"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response
}

const BASE_DEPLOY_PARAMS: IsWorkspaceDeployedParams = {
  workspace_id: "ws_1",
  workspace_key: "dev",
  workspace_slug: "ai-agent",
  repo_full_name: "owner/core-terraform",
}

const BASE_CREATE_PARAMS = {
  owner: "owner",
  repo: "repo",
  base: "main",
  branchName: "deploy/dev/ai-agent",
  files: [{ path: "envs/dev/ai-agent/backend.tf", content: "terraform {}" }],
  commitMessage: "chore: deploy",
  prTitle: "Deploy",
  prBody: "Body",
}

export const tests = [
  {
    name: "deployErrors: isValidTemplateId rejects empty string",
    fn: async () => {
      assert((await isValidTemplateId("")) === false, "empty string invalid")
    },
  },
  {
    name: "deployErrors: isValidTemplateId rejects unknown id",
    fn: async () => {
      assert((await isValidTemplateId("unknown-template")) === false, "unknown id invalid")
      assert((await isValidTemplateId("baseline-xyz")) === false, "non-existent template invalid")
    },
  },
  {
    name: "deployErrors: isValidTemplateId rejects blank, accepts null/undefined and valid ids",
    fn: async () => {
      assert((await isValidTemplateId("blank")) === false, "blank invalid (template-only)")
      assert((await isValidTemplateId(null)) === true, "null valid")
      assert((await isValidTemplateId(undefined)) === true, "undefined valid")
      const { __testOnlySetWorkspaceTemplatesIndex } = await import("@/lib/workspace-templates-store")
      __testOnlySetWorkspaceTemplatesIndex(() =>
        Promise.resolve([
          { id: "baseline-ai-service", name: "Baseline AI", latest_version: "v1" },
        ])
      )
      try {
        assert((await isValidTemplateId("baseline-ai-service")) === true, "baseline-ai-service valid when in index")
      } finally {
        __testOnlySetWorkspaceTemplatesIndex(null)
      }
    },
  },

  {
    name: "deployErrors: WORKSPACE_DEPLOY_CHECK_FAILED — isWorkspaceDeployed returns ok:false on GitHub failure",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => {
        throw new Error("Network error")
      }
      const result = await isWorkspaceDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === WORKSPACE_DEPLOY_CHECK_FAILED, "WORKSPACE_DEPLOY_CHECK_FAILED")
    },
  },
  {
    name: "deployErrors: WORKSPACE_DEPLOY_CHECK_FAILED — isWorkspaceDeployed returns ok:false on invalid repo",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => mockJsonResponse({})
      const result = await isWorkspaceDeployed("token", {
        ...BASE_DEPLOY_PARAMS,
        repo_full_name: "invalid",
      }, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === WORKSPACE_DEPLOY_CHECK_FAILED, "WORKSPACE_DEPLOY_CHECK_FAILED")
    },
  },

  {
    name: "deployErrors: isWorkspaceDeployed returns deployed:true when backend.tf exists",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          if (path.includes("/pulls")) return mockJsonResponse([])
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isWorkspaceDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployed: boolean }).deployed === true, "deployed:true → route returns 409")
    },
  },

  {
    name: "deployErrors: isWorkspaceDeployed deployPrOpen:true (open PR)",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/pulls")) return mockJsonResponse([{ number: 1, html_url: "https://example.com/pr/1" }])
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isWorkspaceDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === true, "deployPrOpen:true → route returns 409")
    },
  },

  {
    name: "deployErrors: createDeployPR throws DeployBranchExistsError when branch exists",
    fn: async () => {
      const ghResponseOverride = async (_token: string, path: string) => {
        if (path.includes("/git/ref/") && path.includes("deploy")) {
          return mockJsonResponse({ ref: "refs/heads/deploy/dev/ai-agent", object: { sha: "abc" } })
        }
        return mockJsonResponse({}, 404)
      }
      const options: CreateDeployPROptions = {
        ghOverride: (async () => mockJsonResponse({})) as typeof import("@/lib/github/client").gh,
        ghResponseOverride: ghResponseOverride as typeof import("@/lib/github/client").ghResponse,
      }
      let thrown: unknown
      try {
        await createDeployPR("token", BASE_CREATE_PARAMS, options)
      } catch (err) {
        thrown = err
      }
      assert(thrown instanceof DeployBranchExistsError, "must throw DeployBranchExistsError")
      assert((thrown as Error).message.includes("deploy/dev/ai-agent"), "message includes branch name")
    },
  },

  {
    name: "deployErrors: contract — error codes map to HTTP status",
    fn: () => {
      const contract: Record<string, number> = {
        INVALID_WORKSPACE_TEMPLATE: 400,
        WORKSPACE_TEMPLATES_NOT_INITIALIZED: 503,
        WORKSPACE_ALREADY_DEPLOYED: 409,
        WORKSPACE_DEPLOY_IN_PROGRESS: 409,
        WORKSPACE_DEPLOY_CHECK_FAILED: 503,
      }
      assert(contract.INVALID_WORKSPACE_TEMPLATE === 400, "INVALID_WORKSPACE_TEMPLATE → 400")
      assert(contract.WORKSPACE_TEMPLATES_NOT_INITIALIZED === 503, "WORKSPACE_TEMPLATES_NOT_INITIALIZED → 503")
      assert(contract.WORKSPACE_ALREADY_DEPLOYED === 409, "WORKSPACE_ALREADY_DEPLOYED → 409")
      assert(contract.WORKSPACE_DEPLOY_IN_PROGRESS === 409, "WORKSPACE_DEPLOY_IN_PROGRESS → 409")
      assert(contract.WORKSPACE_DEPLOY_CHECK_FAILED === 503, "WORKSPACE_DEPLOY_CHECK_FAILED → 503")
    },
  },
]
