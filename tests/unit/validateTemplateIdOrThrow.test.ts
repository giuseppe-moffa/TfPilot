/**
 * Unit tests: validateTemplateIdOrThrow.
 * S3-backed template validation; uses S3 stub for deterministic tests.
 */

import { createS3Stub, TEST_BUCKET } from "../fixtures/s3-stub"
import {
  __testOnlySetS3,
  seedEnvTemplatesFromConfig,
  disableEnvTemplate,
} from "@/lib/env-templates-store"
import {
  validateTemplateIdOrThrow,
  INVALID_ENV_TEMPLATE,
  ENV_TEMPLATES_NOT_INITIALIZED,
} from "@/lib/environments/validateTemplateId"

const stub = createS3Stub()

function useStub() {
  __testOnlySetS3(stub, TEST_BUCKET)
  stub.clear()
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const TEST_ORG_ID = "default"

export const tests = [
  {
    name: "validateTemplateIdOrThrow: null resolves (no throw)",
    fn: async () => {
      useStub()
      await validateTemplateIdOrThrow(null, TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: undefined resolves (no throw)",
    fn: async () => {
      useStub()
      await validateTemplateIdOrThrow(undefined, TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: blank resolves even when index missing",
    fn: async () => {
      useStub()
      await validateTemplateIdOrThrow("blank", TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: empty string throws INVALID_ENV_TEMPLATE",
    fn: async () => {
      useStub()
      try {
        await validateTemplateIdOrThrow("", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_ENV_TEMPLATE, `Expected ${INVALID_ENV_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: whitespace-only throws INVALID_ENV_TEMPLATE",
    fn: async () => {
      useStub()
      try {
        await validateTemplateIdOrThrow("   ", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_ENV_TEMPLATE, `Expected ${INVALID_ENV_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: unknown id when index present throws INVALID_ENV_TEMPLATE",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig(TEST_ORG_ID, [
        { id: "baseline-ai-service", label: "Baseline AI", modules: [] },
      ])
      try {
        await validateTemplateIdOrThrow("unknown", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_ENV_TEMPLATE, `Expected ${INVALID_ENV_TEMPLATE}, got ${code}`)
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: non-blank when index missing throws ENV_TEMPLATES_NOT_INITIALIZED",
    fn: async () => {
      useStub()
      try {
        await validateTemplateIdOrThrow("baseline-ai-service", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === ENV_TEMPLATES_NOT_INITIALIZED,
          `Expected ${ENV_TEMPLATES_NOT_INITIALIZED}, got ${code}`
        )
      }
    },
  },
  {
    name: "validateTemplateIdOrThrow: baseline-ai-service when index present + enabled resolves",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig(TEST_ORG_ID, [
        { id: "baseline-ai-service", label: "Baseline AI", modules: [] },
      ])
      await validateTemplateIdOrThrow("baseline-ai-service", TEST_ORG_ID)
    },
  },
  {
    name: "validateTemplateIdOrThrow: baseline-ai-service when disabled throws INVALID_ENV_TEMPLATE",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig(TEST_ORG_ID, [
        { id: "baseline-ai-service", label: "Baseline AI", modules: [] },
      ])
      await disableEnvTemplate(TEST_ORG_ID, "baseline-ai-service")
      try {
        await validateTemplateIdOrThrow("baseline-ai-service", TEST_ORG_ID)
        throw new Error("Expected throw")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === INVALID_ENV_TEMPLATE, `Expected ${INVALID_ENV_TEMPLATE}, got ${code}`)
      }
    },
  },
]
