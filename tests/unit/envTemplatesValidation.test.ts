/**
 * Unit tests: env-templates validation (invalid module, invalid defaultConfig).
 * Uses S3 stub for seed test (envTemplatesIndexExists); validation runs before S3 for create.
 */

import { createS3Stub, TEST_BUCKET } from "../fixtures/s3-stub"
import {
  __testOnlySetS3,
  createEnvTemplate,
  seedEnvTemplatesFromConfig,
  ENV_TEMPLATE_VALIDATION_FAILED,
} from "@/lib/env-templates-store"

const valStub = createS3Stub()
__testOnlySetS3(valStub, TEST_BUCKET)

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "envTemplatesValidation: invalid module rejects",
    fn: async () => {
      try {
        await createEnvTemplate({
          label: "Test",
          modules: [{ module: "invalid-module-xyz", order: 1 }],
          enabled: true,
        })
        throw new Error("Expected createEnvTemplate to throw for invalid module")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === ENV_TEMPLATE_VALIDATION_FAILED,
          `Expected ENV_TEMPLATE_VALIDATION_FAILED, got ${code}`
        )
      }
    },
  },
  {
    name: "envTemplatesValidation: invalid defaultConfig key rejects",
    fn: async () => {
      try {
        await createEnvTemplate({
          label: "Test",
          modules: [
            {
              module: "s3-bucket",
              order: 1,
              defaultConfig: { unknown_key: "value" },
            },
          ],
          enabled: true,
        })
        throw new Error("Expected createEnvTemplate to throw for invalid defaultConfig key")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === ENV_TEMPLATE_VALIDATION_FAILED,
          `Expected ENV_TEMPLATE_VALIDATION_FAILED, got ${code}`
        )
      }
    },
  },
  {
    name: "envTemplatesValidation: unknown top-level field rejects",
    fn: async () => {
      try {
        await createEnvTemplate({
          label: "Test",
          modules: [],
          enabled: true,
          foo: "bar", // unknown field
        } as Parameters<typeof createEnvTemplate>[0])
        throw new Error("Expected createEnvTemplate to throw for unknown top-level field")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === ENV_TEMPLATE_VALIDATION_FAILED,
          `Expected ENV_TEMPLATE_VALIDATION_FAILED, got ${code}`
        )
      }
    },
  },
  {
    name: "envTemplatesValidation: seedEnvTemplatesFromConfig rejects invalid module in config",
    fn: async () => {
      __testOnlySetS3(valStub, TEST_BUCKET)
      valStub.clear()
      try {
        await seedEnvTemplatesFromConfig([
          { id: "bad", label: "Bad", modules: [{ module: "invalid-module", order: 1 }] },
        ])
        throw new Error("Expected seedEnvTemplatesFromConfig to throw for invalid module")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(
          code === ENV_TEMPLATE_VALIDATION_FAILED,
          `Expected ENV_TEMPLATE_VALIDATION_FAILED, got ${code}`
        )
      }
    },
  },
]
