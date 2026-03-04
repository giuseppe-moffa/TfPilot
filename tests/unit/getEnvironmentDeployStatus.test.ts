/**
 * Unit tests: getEnvironmentDeployStatus.
 * Chunk 6.1 — deploy status for UI.
 */

import {
  getEnvironmentDeployStatus,
  type EnvironmentForDeployStatus,
} from "@/lib/environments/getEnvironmentDeployStatus"
import type { DeployCheckFetcher } from "@/lib/environments/isEnvironmentDeployed"

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

const BASE_ENV: EnvironmentForDeployStatus = {
  environment_id: "env_1",
  environment_key: "dev",
  environment_slug: "ai-agent",
  repo_full_name: "owner/core-terraform",
}

export const tests = [
  {
    name: "getEnvironmentDeployStatus: deployed",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/pulls")) return mockJsonResponse([])
        if (path.includes("/contents/")) return mockJsonResponse({})
        if (path.includes("/repos/")) return mockJsonResponse({ default_branch: "main" })
        return mockJsonResponse({}, 404)
      }
      const result = await getEnvironmentDeployStatus("token", BASE_ENV, fetcher)
      assert("error" in result === false, "no error")
      assert((result as { deployed: boolean }).deployed === true, "deployed")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === false, "deployPrOpen false")
    },
  },
  {
    name: "getEnvironmentDeployStatus: deploy in progress",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("/pulls")) return mockJsonResponse([{ number: 1 }])
        if (path.includes("/contents/")) return mockJsonResponse({})
        return mockJsonResponse({ default_branch: "main" })
      }
      const result = await getEnvironmentDeployStatus("token", BASE_ENV, fetcher)
      assert("error" in result === false, "no error")
      assert((result as { deployPrOpen: boolean }).deployPrOpen === true, "deployPrOpen true")
    },
  },
  {
    name: "getEnvironmentDeployStatus: not deployed",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async (path) => {
        if (path.includes("backend.tf")) return mockJsonResponse({}, 404)
        if (path.includes("envs/dev/ai-agent") && !path.includes("backend")) return mockJsonResponse({}, 404)
        if (path.includes("/pulls")) return mockJsonResponse([])
        return mockJsonResponse({ default_branch: "main" })
      }
      const result = await getEnvironmentDeployStatus("token", BASE_ENV, fetcher)
      assert("error" in result === false, "no error")
      assert((result as { deployed: boolean }).deployed === false, "not deployed")
    },
  },
  {
    name: "getEnvironmentDeployStatus: GitHub failure — fail closed",
    fn: async () => {
      const fetcher: DeployCheckFetcher = async () => {
        throw new Error("Network error")
      }
      const result = await getEnvironmentDeployStatus("token", BASE_ENV, fetcher)
      assert("error" in result === true, "has error")
      assert((result as { deployed: boolean }).deployed === false, "deployed false on fail")
      assert((result as { deployPrOpen: unknown }).deployPrOpen === null, "deployPrOpen null when unverifiable")
      assert((result as { envRootExists: unknown }).envRootExists === null, "envRootExists null when unverifiable")
      assert((result as { error: string }).error === "ENV_DEPLOY_CHECK_FAILED", "correct error")
    },
  },
]
