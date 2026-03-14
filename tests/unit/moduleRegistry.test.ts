/**
 * Unit tests: module registry.
 * Chunk 4.1 — cloudwatch-log-group and iam-role must be registered.
 * Template-only: default workspace seed templates use these module ids; all must be in registry.
 */

import { moduleRegistry } from "@/config/module-registry"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const registryTypes = new Set(moduleRegistry.map((m) => m.type))

/** Module ids used by default workspace template seed (baseline-ai-service, baseline-app-service, baseline-worker-service). */
const DEFAULT_TEMPLATE_MODULE_IDS = ["ecr-repo", "cloudwatch-log-group", "iam-role", "s3-bucket"]

export const tests = [
  {
    name: "moduleRegistry: includes cloudwatch-log-group",
    fn: () => {
      assert(registryTypes.has("cloudwatch-log-group"), "cloudwatch-log-group must be in registry")
      const entry = moduleRegistry.find((m) => m.type === "cloudwatch-log-group")
      assert(entry != null, "cloudwatch-log-group entry exists")
      assert(Array.isArray(entry!.fields) && entry!.fields.length > 0, "has fields")
    },
  },
  {
    name: "moduleRegistry: includes iam-role",
    fn: () => {
      assert(registryTypes.has("iam-role"), "iam-role must be in registry")
      const entry = moduleRegistry.find((m) => m.type === "iam-role")
      assert(entry != null, "iam-role entry exists")
      assert(Array.isArray(entry!.fields) && entry!.fields.length > 0, "has fields")
    },
  },
  {
    name: "moduleRegistry: all default workspace template module ids are registered",
    fn: () => {
      for (const moduleId of DEFAULT_TEMPLATE_MODULE_IDS) {
        assert(
          registryTypes.has(moduleId),
          `default template module ${moduleId} must be in registry`
        )
      }
    },
  },
]
