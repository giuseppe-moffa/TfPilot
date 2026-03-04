/**
 * Invariant tests: Model 2 renderer + cleanup (path building, module depth, safe deletion).
 * Phase 3 staged — not used by request routes until cutover.
 */

import {
  computeRequestTfPath,
  MODULE_SOURCE_PREFIX,
  getModuleSourceV2,
  renderModuleBlockV2,
  renderRequestTfContent,
  generateModel2RequestFile,
  getCleanupPathV2,
  assertCleanupPathSafe,
} from "@/lib/renderer/model2"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "computeRequestTfPath: returns correct path for dev/ai-agent",
    fn: () => {
      const p = computeRequestTfPath("dev", "ai-agent", "ecr-repo", "abc123")
      assert(p === "envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_abc123.tf", "path format")
    },
  },
  {
    name: "computeRequestTfPath: manual verification ecr-repo_req_a12bc3",
    fn: () => {
      const p = computeRequestTfPath("dev", "ai-agent", "ecr-repo", "a12bc3")
      assert(p === "envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_a12bc3.tf", "per delta §6.1")
    },
  },
  {
    name: "computeRequestTfPath: slug edge case — hyphenated",
    fn: () => {
      const p = computeRequestTfPath("dev", "feature-123", "s3-bucket", "r1")
      assert(p === "envs/dev/feature-123/tfpilot/requests/s3-bucket_req_r1.tf", "hyphenated slug")
    },
  },
  {
    name: "computeRequestTfPath: slug edge case — single char",
    fn: () => {
      const p = computeRequestTfPath("dev", "a", "misc", "id")
      assert(p === "envs/dev/a/tfpilot/requests/misc_req_id.tf", "single char slug")
    },
  },
  {
    name: "computeRequestTfPath: slug edge case — max length 63",
    fn: () => {
      const slug = "a" + "b".repeat(62)
      const p = computeRequestTfPath("dev", slug, "ecr-repo", "id")
      assert(p.endsWith("/tfpilot/requests/ecr-repo_req_id.tf"), "63-char slug path ends correctly")
      assert(p.includes(`/${slug}/`), "slug preserved in path")
    },
  },
  {
    name: "MODULE_SOURCE_PREFIX: locked to ../../../modules/",
    fn: () => {
      assert(MODULE_SOURCE_PREFIX === "../../../modules/", "depth lock")
    },
  },
  {
    name: "getModuleSourceV2: returns ../../../modules/<module>",
    fn: () => {
      assert(getModuleSourceV2("s3-bucket") === "../../../modules/s3-bucket", "s3 module")
      assert(getModuleSourceV2("ecr-repo") === "../../../modules/ecr-repo", "ecr module")
    },
  },
  {
    name: "renderModuleBlockV2: source line contains ../../../modules/",
    fn: () => {
      const block = renderModuleBlockV2({
        id: "r1",
        module: "s3-bucket",
        config: { name: "test" },
      })
      assert(block.includes('source = "../../../modules/s3-bucket"'), "module source depth")
    },
  },
  {
    name: "renderRequestTfContent: produces valid header + block",
    fn: () => {
      const content = renderRequestTfContent({
        id: "r1",
        module: "ecr-repo",
        config: { name: "myrepo" },
      })
      assert(content.includes("# Managed by TfPilot"), "header present")
      assert(content.includes('source = "../../../modules/ecr-repo"'), "module source")
      assert(content.includes("module "), "module block")
    },
  },
  {
    name: "generateModel2RequestFile: path and content match",
    fn: () => {
      const { path, content } = generateModel2RequestFile("dev", "sandbox", {
        id: "xyz",
        module: "misc",
        config: {},
      })
      assert(path === "envs/dev/sandbox/tfpilot/requests/misc_req_xyz.tf", "path correct")
      assert(content.includes('source = "../../../modules/misc"'), "content has module source")
    },
  },
  {
    name: "getCleanupPathV2: matches computeRequestTfPath",
    fn: () => {
      const p = getCleanupPathV2("prod", "payments", "ecr-repo", "req_1")
      assert(p === "envs/prod/payments/tfpilot/requests/ecr-repo_req_req_1.tf", "cleanup path")
    },
  },
  {
    name: "assertCleanupPathSafe: accepts valid path",
    fn: () => {
      const r = assertCleanupPathSafe("envs/dev/ai-agent/tfpilot/requests/ecr-repo_req_abc.tf")
      assert(r.ok === true, "valid path accepted")
    },
  },
  {
    name: "assertCleanupPathSafe: rejects path outside tfpilot/requests",
    fn: () => {
      const r = assertCleanupPathSafe("envs/dev/ai-agent/backend.tf")
      assert(r.ok === false && r.error.includes("tfpilot/requests"), "rejects off-target")
    },
  },
  {
    name: "assertCleanupPathSafe: rejects path with ..",
    fn: () => {
      const r = assertCleanupPathSafe("envs/dev/../prod/tfpilot/requests/req_x.tf")
      assert(r.ok === false && r.error.includes(".."), "rejects path traversal")
    },
  },
  {
    name: "assertCleanupPathSafe: rejects path not matching <module>_req_<id>.tf",
    fn: () => {
      const r = assertCleanupPathSafe("envs/dev/ai-agent/tfpilot/requests/main.tf")
      assert(r.ok === false, "rejects non-req file")
    },
  },
  {
    name: "assertCleanupPathSafe: rejects old req_<id>.tf format",
    fn: () => {
      const r = assertCleanupPathSafe("envs/dev/ai-agent/tfpilot/requests/req_abc.tf")
      assert(r.ok === false, "rejects legacy req_<id>.tf format")
    },
  },
]
