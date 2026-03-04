/**
 * Unit tests: envSkeleton.
 * Step 7: S3-backed; blank uses built-in; non-blank uses S3 stub.
 */

import { createS3Stub, TEST_BUCKET } from "../fixtures/s3-stub"
import { __testOnlySetS3, seedEnvTemplatesFromConfig } from "@/lib/env-templates-store"
import { envSkeleton } from "@/lib/environments/envSkeleton"
import { INVALID_ENV_TEMPLATE } from "@/lib/environments/validateTemplateId"

const stub = createS3Stub()

function useStub() {
  __testOnlySetS3(stub, TEST_BUCKET)
  stub.clear()
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const expectedBasePaths = [
  "backend.tf",
  "providers.tf",
  "versions.tf",
  "tfpilot/base.tf",
  "tfpilot/requests/.gitkeep",
]

const baselineAiModules = ["ecr-repo", "cloudwatch-log-group", "iam-role", "s3-bucket"]

export const tests = [
  {
    name: "envSkeleton: blank template has no module files (no S3)",
    fn: async () => {
      const result = await envSkeleton({
        environment_key: "staging",
        environment_slug: "empty",
        template_id: "blank",
      })
      assert(result.envRoot === "envs/staging/empty", `envRoot must be envs/staging/empty, got ${result.envRoot}`)
      const reqFiles = result.files.filter(
        (f) => f.path.includes("tfpilot/requests/") && f.path.endsWith(".tf") && !f.path.endsWith(".gitkeep")
      )
      assert(reqFiles.length === 0, "Blank template must have no module request files")
      for (const rel of expectedBasePaths) {
        const fullPath = result.envRoot + "/" + rel
        assert(result.files.some((f) => f.path === fullPath), `Expected file ${fullPath}`)
      }
    },
  },
  {
    name: "envSkeleton: correct ENV_ROOT",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([
        {
          id: "baseline-ai-service",
          label: "Baseline AI",
          modules: [
            { module: "ecr-repo", order: 1 },
            { module: "cloudwatch-log-group", order: 2 },
            { module: "iam-role", order: 3 },
            { module: "s3-bucket", order: 4 },
          ],
        },
      ])
      const result = await envSkeleton({
        environment_key: "dev",
        environment_slug: "ai-agent",
        template_id: "baseline-ai-service",
      })
      assert(result.envRoot === "envs/dev/ai-agent", `envRoot must be envs/dev/ai-agent, got ${result.envRoot}`)
    },
  },
  {
    name: "envSkeleton: correct file tree for baseline-ai-service",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([
        {
          id: "baseline-ai-service",
          label: "Baseline AI",
          modules: [
            { module: "ecr-repo", order: 1 },
            { module: "cloudwatch-log-group", order: 2 },
            { module: "iam-role", order: 3 },
            { module: "s3-bucket", order: 4 },
          ],
        },
      ])
      const result = await envSkeleton({
        environment_key: "dev",
        environment_slug: "ai-agent",
        template_id: "baseline-ai-service",
      })
      const prefix = result.envRoot + "/"
      for (const rel of expectedBasePaths) {
        const fullPath = prefix + rel
        const found = result.files.some((f) => f.path === fullPath)
        assert(found, `Expected file ${fullPath}`)
      }
    },
  },
  {
    name: "envSkeleton: request filenames have no double req_ prefix",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([
        {
          id: "baseline-ai-service",
          label: "Baseline AI",
          modules: [
            { module: "ecr-repo", order: 1 },
            { module: "cloudwatch-log-group", order: 2 },
            { module: "iam-role", order: 3 },
            { module: "s3-bucket", order: 4 },
          ],
        },
      ])
      const result = await envSkeleton({
        environment_key: "dev",
        environment_slug: "ai-agent",
        template_id: "baseline-ai-service",
      })
      const reqFiles = result.files.filter(
        (f) => f.path.includes("tfpilot/requests/") && f.path.endsWith(".tf")
      )
      for (const f of reqFiles) {
        const basename = f.path.split("/").pop() ?? ""
        assert(!basename.includes("_req_req_"), `Filename must not contain _req_req_: ${basename}`)
      }
    },
  },
  {
    name: "envSkeleton: module request files generated in template order",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([
        {
          id: "baseline-ai-service",
          label: "Baseline AI",
          modules: [
            { module: "ecr-repo", order: 1 },
            { module: "cloudwatch-log-group", order: 2 },
            { module: "iam-role", order: 3 },
            { module: "s3-bucket", order: 4 },
          ],
        },
      ])
      const result = await envSkeleton({
        environment_key: "dev",
        environment_slug: "ai-agent",
        template_id: "baseline-ai-service",
      })
      const reqFiles = result.files.filter(
        (f) =>
          f.path.includes("tfpilot/requests/") &&
          f.path.endsWith(".tf") &&
          !f.path.endsWith(".gitkeep")
      )
      assert(
        reqFiles.length === baselineAiModules.length,
        `Expected ${baselineAiModules.length} request files, got ${reqFiles.length}`
      )
      for (let i = 0; i < baselineAiModules.length; i++) {
        const mod = baselineAiModules[i]
        const file = reqFiles[i]
        assert(file!.path.includes(`${mod}_req_`), `File ${i} should be for ${mod}, got ${file!.path}`)
      }
    },
  },
  {
    name: "envSkeleton: throws INVALID_ENV_TEMPLATE when non-blank doc missing",
    fn: async () => {
      useStub()
      let threw = false
      let code: string | undefined
      try {
        await envSkeleton({
          environment_key: "dev",
          environment_slug: "x",
          template_id: "nonexistent",
        })
      } catch (err: unknown) {
        threw = true
        code = (err as { code?: string })?.code
      }
      assert(threw, "Must throw on missing doc")
      assert(
        code === INVALID_ENV_TEMPLATE,
        `Expected ${INVALID_ENV_TEMPLATE}, got ${code}`
      )
    },
  },
]
