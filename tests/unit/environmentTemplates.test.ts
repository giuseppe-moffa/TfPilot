/**
 * Unit tests: environment templates config.
 * Asserts template count and module ordering per ENVIRONMENT_TEMPLATES_DELTA.
 */

import { environmentTemplates } from "@/config/environment-templates"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "environmentTemplates: has expected count",
    fn: () => {
      assert(environmentTemplates.length === 4, "expect 4 templates: blank, baseline-ai-service, baseline-app-service, baseline-worker-service")
    },
  },
  {
    name: "environmentTemplates: template ids are unique",
    fn: () => {
      const ids = environmentTemplates.map((t) => t.id)
      const set = new Set(ids)
      assert(set.size === ids.length, "template ids must be unique")
    },
  },
  {
    name: "environmentTemplates: blank has no modules",
    fn: () => {
      const blank = environmentTemplates.find((t) => t.id === "blank")
      assert(blank != null, "blank template exists")
      assert(Array.isArray(blank!.modules) && blank!.modules.length === 0, "blank has empty modules")
    },
  },
  {
    name: "environmentTemplates: modules sorted by order ascending",
    fn: () => {
      for (const t of environmentTemplates) {
        for (let i = 1; i < t.modules.length; i++) {
          assert(
            t.modules[i]!.order >= t.modules[i - 1]!.order,
            `template ${t.id}: module ${i} order ${t.modules[i]!.order} >= previous ${t.modules[i - 1]!.order}`
          )
        }
      }
    },
  },
  {
    name: "environmentTemplates: baseline-ai-service has correct modules in order",
    fn: () => {
      const t = environmentTemplates.find((t) => t.id === "baseline-ai-service")
      assert(t != null, "baseline-ai-service exists")
      const mods = t!.modules.map((m) => m.module)
      assert(
        JSON.stringify(mods) === '["ecr-repo","cloudwatch-log-group","iam-role","s3-bucket"]',
        `baseline-ai-service modules: expected ecr-repo,cloudwatch-log-group,iam-role,s3-bucket; got ${mods.join(",")}`
      )
    },
  },
  {
    name: "environmentTemplates: baseline-app-service has correct modules",
    fn: () => {
      const t = environmentTemplates.find((t) => t.id === "baseline-app-service")
      assert(t != null, "baseline-app-service exists")
      const mods = t!.modules.map((m) => m.module)
      assert(
        JSON.stringify(mods) === '["cloudwatch-log-group","iam-role","s3-bucket"]',
        `baseline-app-service modules: expected cloudwatch-log-group,iam-role,s3-bucket; got ${mods.join(",")}`
      )
    },
  },
  {
    name: "environmentTemplates: baseline-worker-service has correct modules",
    fn: () => {
      const t = environmentTemplates.find((t) => t.id === "baseline-worker-service")
      assert(t != null, "baseline-worker-service exists")
      const mods = t!.modules.map((m) => m.module)
      assert(
        JSON.stringify(mods) === '["cloudwatch-log-group","iam-role","s3-bucket"]',
        `baseline-worker-service modules: expected cloudwatch-log-group,iam-role,s3-bucket; got ${mods.join(",")}`
      )
    },
  },
]
