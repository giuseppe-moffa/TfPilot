/**
 * Unit tests: envSkeleton.
 * Phase 5 — Chunk 5.1.
 */

import { envSkeleton } from "@/lib/environments/envSkeleton"

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
    name: "envSkeleton: correct ENV_ROOT",
    fn: () => {
      const result = envSkeleton({ environment_key: "dev", environment_slug: "ai-agent", template_id: "baseline-ai-service" })
      assert(result.envRoot === "envs/dev/ai-agent", `envRoot must be envs/dev/ai-agent, got ${result.envRoot}`)
    },
  },
  {
    name: "envSkeleton: correct file tree for baseline-ai-service",
    fn: () => {
      const result = envSkeleton({ environment_key: "dev", environment_slug: "ai-agent", template_id: "baseline-ai-service" })
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
    fn: () => {
      const result = envSkeleton({ environment_key: "dev", environment_slug: "ai-agent", template_id: "baseline-ai-service" })
      const reqFiles = result.files.filter((f) => f.path.includes("tfpilot/requests/") && f.path.endsWith(".tf"))
      for (const f of reqFiles) {
        const basename = f.path.split("/").pop() ?? ""
        assert(!basename.includes("_req_req_"), `Filename must not contain _req_req_: ${basename}`)
      }
    },
  },
  {
    name: "envSkeleton: module request files generated in template order",
    fn: () => {
      const result = envSkeleton({ environment_key: "dev", environment_slug: "ai-agent", template_id: "baseline-ai-service" })
      const reqFiles = result.files.filter((f) => f.path.includes("tfpilot/requests/") && f.path.endsWith(".tf") && !f.path.endsWith(".gitkeep"))
      assert(reqFiles.length === baselineAiModules.length, `Expected ${baselineAiModules.length} request files, got ${reqFiles.length}`)
      for (let i = 0; i < baselineAiModules.length; i++) {
        const mod = baselineAiModules[i]
        const file = reqFiles[i]
        assert(file.path.includes(`${mod}_req_`), `File ${i} should be for ${mod}, got ${file.path}`)
      }
    },
  },
  {
    name: "envSkeleton: blank template has no module files",
    fn: () => {
      const result = envSkeleton({ environment_key: "staging", environment_slug: "empty", template_id: "blank" })
      assert(result.envRoot === "envs/staging/empty", `envRoot must be envs/staging/empty, got ${result.envRoot}`)
      const reqFiles = result.files.filter((f) => f.path.includes("tfpilot/requests/") && f.path.endsWith(".tf") && !f.path.endsWith(".gitkeep"))
      assert(reqFiles.length === 0, "Blank template must have no module request files")
    },
  },
  {
    name: "envSkeleton: throws on unknown template_id",
    fn: () => {
      let threw = false
      try {
        envSkeleton({ environment_key: "dev", environment_slug: "x", template_id: "nonexistent" })
      } catch {
        threw = true
      }
      assert(threw, "Must throw on unknown template_id")
    },
  },
]
