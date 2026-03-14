/**
 * Unit tests: validateTemplateIdOrThrow.
 * Uses workspace-templates-store (new S3 layout). No blank. Test override for index.
 */

import {
  validateTemplateIdOrThrow,
  INVALID_WORKSPACE_TEMPLATE,
  WORKSPACE_TEMPLATES_NOT_INITIALIZED,
} from "@/lib/workspaces/validateTemplateId"
import { __testOnlySetWorkspaceTemplatesIndex } from "@/lib/workspace-templates-store"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const TEST_ORG_ID = "default"

const INDEX_WITH_BASELINE = [
  { id: "baseline-ai-service", name: "Baseline AI", latest_version: "v1" },
]

export const tests = [
  {
    name: "validateTemplateIdOrThrow: null resolves (no throw)",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(null)
      await validateTemplateIdOrThrow(null, TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: undefined resolves (no throw)",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(null)
      await validateTemplateIdOrThrow(undefined, TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: blank throws INVALID_WORKSPACE_TEMPLATE (template-only)",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(null)
      try {
        await validateTemplateIdOrThrow("blank", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_WORKSPACE_TEMPLATE, `Expected ${INVALID_WORKSPACE_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: empty string throws INVALID_WORKSPACE_TEMPLATE",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(null)
      try {
        await validateTemplateIdOrThrow("", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_WORKSPACE_TEMPLATE, `Expected ${INVALID_WORKSPACE_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: whitespace-only throws INVALID_WORKSPACE_TEMPLATE",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(null)
      try {
        await validateTemplateIdOrThrow("   ", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_WORKSPACE_TEMPLATE, `Expected ${INVALID_WORKSPACE_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: unknown id when index present throws INVALID_WORKSPACE_TEMPLATE",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(() => Promise.resolve(INDEX_WITH_BASELINE))
      try {
        await validateTemplateIdOrThrow("unknown", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_WORKSPACE_TEMPLATE, `Expected ${INVALID_WORKSPACE_TEMPLATE}, got ${code}`)
      } finally {
        __testOnlySetWorkspaceTemplatesIndex(null)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: non-blank when index missing throws WORKSPACE_TEMPLATES_NOT_INITIALIZED",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(() =>
        Promise.reject(new Error("Workspace templates index not found (S3 key: templates/workspaces/index.json). Seed the templates bucket before use."))
      )
      try {
        await validateTemplateIdOrThrow("baseline-ai-service", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === WORKSPACE_TEMPLATES_NOT_INITIALIZED,
          `Expected ${WORKSPACE_TEMPLATES_NOT_INITIALIZED}, got ${code}`
        )
      } finally {
        __testOnlySetWorkspaceTemplatesIndex(null)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: baseline-ai-service when index present resolves",
    fn: async () => {
      __testOnlySetWorkspaceTemplatesIndex(() => Promise.resolve(INDEX_WITH_BASELINE))
      try {
        await validateTemplateIdOrThrow("baseline-ai-service", TEST_ORG_ID)
      } finally {
        __testOnlySetWorkspaceTemplatesIndex(null)
      }
    },
  },
]
