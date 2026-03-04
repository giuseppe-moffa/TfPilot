/**
 * Unit tests: module registry.
 * Chunk 4.1 — cloudwatch-log-group and iam-role must be registered.
 */

import { moduleRegistry } from "@/config/module-registry"
import { environmentTemplates } from "@/config/environment-templates"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const registryTypes = new Set(moduleRegistry.map((m) => m.type))

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
    name: "moduleRegistry: all environment template module ids are registered",
    fn: () => {
      for (const t of environmentTemplates) {
        for (const m of t.modules) {
          assert(
            registryTypes.has(m.module),
            `template ${t.id} references module ${m.module} which must be in registry`
          )
        }
      }
    },
  },
]
