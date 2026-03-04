/**
 * Unit tests: isEnvironmentDeployed.
 * Phase 5 — Chunk 5.2.
 */

import {
  isEnvironmentDeployed,
  ENV_DEPLOY_CHECK_FAILED,
  type IsEnvironmentDeployedParams,
  type DeployCheckFetcher,
} from "@/lib/environments/isEnvironmentDeployed"
import { getDeployBranchName } from "@/lib/environments/checkDeployBranch"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const BASE_PARAMS: IsEnvironmentDeployedParams = {
  environment_id: "env_1",
  environment_key: "dev",
  environment_slug: "ai-agent",
  repo_full_name: "owner/core-terraform",
}

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response
}

export const tests = [
  {
    name: "getDeployBranchName: returns correct format",
    fn: () => {
      const name = getDeployBranchName("dev", "ai-agent")
      assert(name === "deploy/dev/ai-agent", `expected deploy/dev/ai-agent, got ${name}`)
    },
  },
  {
    name: "isEnvironmentDeployed: deployed environment (backend.tf exists)",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          if (path.includes("/pulls")) return mockJsonResponse([])
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployed: boolean }).deployed === true, "deployed")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === false, "deployPrOpen false")
      assert((result as { envRootExists: boolean }).envRootExists === true, "envRootExists")
    },
  },
  {
    name: "isEnvironmentDeployed: undeployed environment (backend.tf 404)",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/owner/core-terraform")) {
          if (path.includes("backend.tf")) return mockJsonResponse({}, 404)
          if (path.includes("envs/dev/ai-agent") && !path.includes("backend")) return mockJsonResponse({}, 404)
          if (path.includes("/pulls")) return mockJsonResponse([])
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployed: boolean }).deployed === false, "not deployed")
    },
  },
  {
    name: "isEnvironmentDeployed: open deploy PR",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/repos/")) {
          if (path.includes("/pulls"))
            return mockJsonResponse([{ number: 42, html_url: "https://github.com/owner/repo/pull/42" }])
          if (path.includes("/contents/")) return mockJsonResponse({}, 200)
          return mockJsonResponse({ default_branch: "main" })
        }
        return mockJsonResponse({}, 404)
      }
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === true, "deployPrOpen")
      assert((result as { deployPrUrl?: string }).deployPrUrl === "https://github.com/owner/repo/pull/42", "deployPrUrl")
    },
  },
  {
    name: "isEnvironmentDeployed: GitHub lookup failure → ENV_DEPLOY_CHECK_FAILED",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => {
        throw new Error("Network error")
      }
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === ENV_DEPLOY_CHECK_FAILED, "ENV_DEPLOY_CHECK_FAILED")
    },
  },
  {
    name: "isEnvironmentDeployed: repo 404 → ENV_DEPLOY_CHECK_FAILED",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => mockJsonResponse({}, 404)
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === ENV_DEPLOY_CHECK_FAILED, "ENV_DEPLOY_CHECK_FAILED")
    },
  },
  {
    name: "isEnvironmentDeployed: invalid repo_full_name → ENV_DEPLOY_CHECK_FAILED",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => mockJsonResponse({})
      const result = await isEnvironmentDeployed("token", { ...BASE_PARAMS, repo_full_name: "invalid" }, fetcher)
      assert(result.ok === false, "expected failure")
      assert((result as { error: string }).error === ENV_DEPLOY_CHECK_FAILED, "ENV_DEPLOY_CHECK_FAILED")
    },
  },
  {
    name: "isEnvironmentDeployed: deployed check uses exact backend.tf path (not directory)",
    fn: async () => {
      const paths: string[] = []
      const fetcher: DeployCheckFetcher = async (path) => {
        paths.push(path)
        if (path.includes("backend.tf")) return mockJsonResponse({}, 200)
        if (path.includes("envs/dev/ai-agent") && !path.includes("backend")) return mockJsonResponse({}, 404)
        if (path.includes("/pulls")) return mockJsonResponse([])
        return mockJsonResponse({ default_branch: "main" })
      }
      const result = await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      assert(result.ok === true, "expected ok")
      assert((result as { deployed: boolean }).deployed === true, "deployed via backend.tf")
      const backendCall = paths.find((p) => p.includes("backend.tf"))
      if (!backendCall) throw new Error("must call contents API for backend.tf")
      assert(
        backendCall.includes("envs/dev/ai-agent/backend.tf") || backendCall.includes("envs%2Fdev%2Fai-agent%2Fbackend.tf"),
        "exact path envs/<key>/<slug>/backend.tf (not directory only)"
      )
    },
  },
  {
    name: "isEnvironmentDeployed: PR query uses state=open and head=deploy/<key>/<slug>",
    fn: async () => {
      const paths: string[] = []
      const fetcher: DeployCheckFetcher = async (path) => {
        paths.push(path)
        if (path.includes("/pulls")) return mockJsonResponse([])
        if (path.includes("/contents/")) return mockJsonResponse({}, 200)
        return mockJsonResponse({ default_branch: "main" })
      }
      await isEnvironmentDeployed("token", BASE_PARAMS, fetcher)
      const prCall = paths.find((p) => p.includes("/pulls"))
      if (!prCall) throw new Error("must call pulls API")
      assert(prCall.includes("state=open"), "must filter open PRs only")
      assert(prCall.includes("head="), "must filter by head branch")
      assert(prCall.includes("deploy"), "head must include deploy/<key>/<slug>")
    },
  },
]
