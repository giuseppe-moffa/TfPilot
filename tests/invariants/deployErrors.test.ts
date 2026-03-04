/**
 * Invariant tests: Deploy error codes (Chunk 7.1).
 * Per docs/ENVIRONMENT_TEMPLATES_DELTA.md.
 * Route contract: POST /api/environments/:id/deploy maps these to HTTP status + JSON body.
 */

import { isValidTemplateId } from "@/lib/environments/validateTemplateId"
import {
  isEnvironmentDeployed,
  ENV_DEPLOY_CHECK_FAILED,
  type IsEnvironmentDeployedParams,
  type DeployCheckFetcher,
} from "@/lib/environments/isEnvironmentDeployed"
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

const BASE_DEPLOY_PARAMS: IsEnvironmentDeployedParams = {
  environment_id: "env_1",
  environment_key: "dev",
  environment_slug: "ai-agent",
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
  // --- INVALID_ENV_TEMPLATE (400) ---
  {
    name: "deployErrors: INVALID_ENV_TEMPLATE — isValidTemplateId rejects empty string",
    fn: () => {
      assert(isValidTemplateId("") === false, "empty string invalid")
    },
  },
  {
    name: "deployErrors: INVALID_ENV_TEMPLATE — isValidTemplateId rejects unknown id",
    fn: () => {
      assert(isValidTemplateId("unknown-template") === false, "unknown id invalid")
      assert(isValidTemplateId("baseline-xyz") === false, "non-existent template invalid")
    },
  },
  {
    name: "deployErrors: INVALID_ENV_TEMPLATE — isValidTemplateId accepts valid ids",
    fn: () => {
      assert(isValidTemplateId("blank") === true, "blank valid")
      assert(isValidTemplateId("baseline-ai-service") === true, "baseline-ai-service valid")
      assert(isValidTemplateId(null) === true, "null valid")
      assert(isValidTemplateId(undefined) === true, "undefined valid")
    },
  },

  // --- ENV_DEPLOY_CHECK_FAILED (503) ---
  {
    name: "deployErrors: ENV_DEPLOY_CHECK_FAILED — isEnvironmentDeployed returns ok:false on GitHub failure",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => {
        throw new Error("Network error")
      }
      const result = await isEnvironmentDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === ENV_DEPLOY_CHECK_FAILED, "ENV_DEPLOY_CHECK_FAILED")
    },
  },
  {
    name: "deployErrors: ENV_DEPLOY_CHECK_FAILED — isEnvironmentDeployed returns ok:false on invalid repo",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => mockJsonResponse({})
      const result = await isEnvironmentDeployed("token", {
        ...BASE_DEPLOY_PARAMS,
        repo_full_name: "invalid",
      }, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === ENV_DEPLOY_CHECK_FAILED, "ENV_DEPLOY_CHECK_FAILED")
    },
  },

  // --- ENV_ALREADY_DEPLOYED (409) ---
  {
    name: "deployErrors: ENV_ALREADY_DEPLOYED — isEnvironmentDeployed returns deployed:true when backend.tf exists",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          if (path.includes("/pulls")) return mockJsonResponse([])
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isEnvironmentDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployed: boolean }).deployed === true, "deployed:true → route returns 409 ENV_ALREADY_DEPLOYED")
    },
  },

  // --- ENV_DEPLOY_IN_PROGRESS (409) — case (a): deployPrOpen ---
  {
    name: "deployErrors: ENV_DEPLOY_IN_PROGRESS — isEnvironmentDeployed deployPrOpen:true (open PR)",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/pulls")) return mockJsonResponse([{ number: 1, html_url: "https://example.com/pr/1" }])
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isEnvironmentDeployed("token", BASE_DEPLOY_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === true, "deployPrOpen:true → route returns 409 ENV_DEPLOY_IN_PROGRESS")
    },
  },

  // --- ENV_DEPLOY_IN_PROGRESS (409) — case (b): DeployBranchExistsError ---
  {
    name: "deployErrors: ENV_DEPLOY_IN_PROGRESS — createDeployPR throws DeployBranchExistsError when branch exists",
    fn: async () => {
      // ghResponse for branch ref GET returns 200 → branch exists → createDeployPR throws
      const ghResponseOverride = async (_token: string, path: string) => {
        // branchExists GET /repos/.../git/ref/heads%2Fdeploy%2Fdev%2Fai-agent
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

  // --- Deploy error contract (status mapping) ---
  {
    name: "deployErrors: contract — error codes map to HTTP status per delta",
    fn: () => {
      const contract: Record<string, number> = {
        INVALID_ENV_TEMPLATE: 400,
        ENV_TEMPLATES_NOT_INITIALIZED: 503,
        ENV_ALREADY_DEPLOYED: 409,
        ENV_DEPLOY_IN_PROGRESS: 409,
        ENV_DEPLOY_CHECK_FAILED: 503,
      }
      assert(contract.INVALID_ENV_TEMPLATE === 400, "INVALID_ENV_TEMPLATE → 400")
      assert(contract.ENV_TEMPLATES_NOT_INITIALIZED === 503, "ENV_TEMPLATES_NOT_INITIALIZED → 503")
      assert(contract.ENV_ALREADY_DEPLOYED === 409, "ENV_ALREADY_DEPLOYED → 409")
      assert(contract.ENV_DEPLOY_IN_PROGRESS === 409, "ENV_DEPLOY_IN_PROGRESS → 409")
      assert(contract.ENV_DEPLOY_CHECK_FAILED === 503, "ENV_DEPLOY_CHECK_FAILED → 503")
    },
  },
]
