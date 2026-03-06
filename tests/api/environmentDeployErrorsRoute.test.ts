/**
 * Route-level tests: POST /api/environments/:id/deploy error contract.
 * Chunk 7.1 — asserts HTTP status + JSON { error: CODE } for each deploy error.
 * Uses makePOST() with injected mocks; no real GitHub. S3 stubbed for template validation.
 */

import { NextRequest } from "next/server"
import { DeployBranchExistsError } from "@/lib/github/createDeployPR"
import { makePOST, type DeployRouteDeps } from "@/app/api/environments/[id]/deploy/route"
import { createS3Stub, TEST_BUCKET } from "../fixtures/s3-stub"
import {
  __testOnlySetS3,
  seedEnvTemplatesFromConfig,
} from "@/lib/env-templates-store"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const BASE_ENV_ROW = {
  environment_id: "env_test123",
  project_key: "core",
  environment_key: "dev",
  environment_slug: "ai-agent",
  repo_full_name: "owner/core-terraform",
  template_id: "blank" as string | null,
  template_version: "abc",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null as string | null,
}

const TEST_ORG_ID = "default"

const SESSION_MOCKS: Pick<
  DeployRouteDeps,
  "getSessionFromCookies" | "getUserRole" | "getGitHubAccessToken"
> = {
  getSessionFromCookies: async () => ({
    login: "admin",
    accessToken: "token",
    name: null,
    avatarUrl: null,
    orgId: TEST_ORG_ID,
    orgSlug: "default",
  }),
  getUserRole: () => "admin" as const,
  getGitHubAccessToken: async () => "token",
}

const STUB_CREATE_DEPLOY_PR: DeployRouteDeps["createDeployPR"] = async () => ({
  pr_number: 0, pr_url: "", branch_name: "", commit_sha: "",
})

async function callDeployRoute(envId: string, deps: DeployRouteDeps): Promise<Response> {
  const POST = makePOST(deps)
  const req = new NextRequest("http://localhost/api/environments/" + envId + "/deploy", {
    method: "POST",
    body: "{}",
  })
  const res = await POST(req, { params: Promise.resolve({ id: envId }) })
  return res as unknown as Response
}

export const tests = [
  {
    name: "POST /deploy route: 400 INVALID_ENV_TEMPLATE when env has invalid template_id",
    fn: async () => {
      const stub = createS3Stub()
      __testOnlySetS3(stub, TEST_BUCKET)
      stub.clear()
      await seedEnvTemplatesFromConfig(TEST_ORG_ID, [
        { id: "baseline-ai-service", label: "Baseline AI", modules: [] },
      ])
      const res = await callDeployRoute("env_bad_template", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({
          ...BASE_ENV_ROW,
          environment_id: "env_bad_template",
          template_id: "unknown-template",
        }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
        createDeployPR: STUB_CREATE_DEPLOY_PR,
      })
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "INVALID_ENV_TEMPLATE", `expected INVALID_ENV_TEMPLATE, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST /deploy route: 503 ENV_TEMPLATES_NOT_INITIALIZED when index missing and non-blank template",
    fn: async () => {
      const stub = createS3Stub()
      __testOnlySetS3(stub, TEST_BUCKET)
      stub.clear()
      const res = await callDeployRoute("env_not_initialized", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({
          ...BASE_ENV_ROW,
          environment_id: "env_not_initialized",
          template_id: "baseline-ai-service",
        }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
        createDeployPR: STUB_CREATE_DEPLOY_PR,
      })
      assert(res.status === 503, `expected 503, got ${res.status}`)
      const body = await res.json()
      assert(
        body?.error === "ENV_TEMPLATES_NOT_INITIALIZED",
        `expected ENV_TEMPLATES_NOT_INITIALIZED, got ${JSON.stringify(body)}`
      )
    },
  },
  {
    name: "POST /deploy route: 503 ENV_DEPLOY_CHECK_FAILED when isEnvironmentDeployed fails",
    fn: async () => {
      const res = await callDeployRoute("env_503", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({ ...BASE_ENV_ROW, environment_id: "env_503" }),
        isEnvironmentDeployed: async () => ({ ok: false, error: "ENV_DEPLOY_CHECK_FAILED" as const }),
        createDeployPR: STUB_CREATE_DEPLOY_PR,
      })
      assert(res.status === 503, `expected 503, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "ENV_DEPLOY_CHECK_FAILED", `expected ENV_DEPLOY_CHECK_FAILED, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST /deploy route: 409 ENV_ALREADY_DEPLOYED when deployed",
    fn: async () => {
      const res = await callDeployRoute("env_deployed", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({ ...BASE_ENV_ROW, environment_id: "env_deployed" }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: true, deployPrOpen: false, envRootExists: true }),
        createDeployPR: STUB_CREATE_DEPLOY_PR,
      })
      assert(res.status === 409, `expected 409, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "ENV_ALREADY_DEPLOYED", `expected ENV_ALREADY_DEPLOYED, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST /deploy route: 409 ENV_DEPLOY_IN_PROGRESS when deployPrOpen",
    fn: async () => {
      const res = await callDeployRoute("env_pr_open", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({ ...BASE_ENV_ROW, environment_id: "env_pr_open" }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: true, envRootExists: true, deployPrUrl: "https://x.com/pr/1" }),
        createDeployPR: STUB_CREATE_DEPLOY_PR,
      })
      assert(res.status === 409, `expected 409, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "ENV_DEPLOY_IN_PROGRESS", `expected ENV_DEPLOY_IN_PROGRESS, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST /deploy route: 409 ENV_DEPLOY_IN_PROGRESS when createDeployPR throws DeployBranchExistsError",
    fn: async () => {
      const res = await callDeployRoute("env_branch_exists", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({ ...BASE_ENV_ROW, environment_id: "env_branch_exists" }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
        createDeployPR: async () => {
          throw new DeployBranchExistsError("deploy/dev/ai-agent")
        },
      })
      assert(res.status === 409, `expected 409, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "ENV_DEPLOY_IN_PROGRESS", `expected ENV_DEPLOY_IN_PROGRESS, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "POST /deploy route: 201 success when all checks pass",
    fn: async () => {
      const res = await callDeployRoute("env_ok", {
        ...SESSION_MOCKS,
        getEnvironmentById: async () => ({ ...BASE_ENV_ROW, environment_id: "env_ok" }),
        isEnvironmentDeployed: async () => ({ ok: true, deployed: false, deployPrOpen: false, envRootExists: false }),
        createDeployPR: async () => ({
          pr_number: 42,
          pr_url: "https://github.com/owner/repo/pull/42",
          branch_name: "deploy/dev/ai-agent",
          commit_sha: "abc123",
        }),
      })
      assert(res.status === 201, `expected 201, got ${res.status}`)
      const body = await res.json()
      assert(body?.deploy != null, "expected deploy object")
      assert(body.deploy.pr_number === 42, "expected pr_number")
      assert(body.deploy.pr_url === "https://github.com/owner/repo/pull/42", "expected pr_url")
      assert(body.deploy.branch_name === "deploy/dev/ai-agent", "expected branch_name")
      assert(body.deploy.commit_sha === "abc123", "expected commit_sha")
    },
  },
]
