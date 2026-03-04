/**
 * Unit tests: env-templates S3 store.
 * Uses in-memory S3 stub — no AWS credentials, deterministic, runs in CI.
 */

import { createS3Stub, TEST_BUCKET } from "../fixtures/s3-stub"
import {
  __testOnlySetS3,
  getEnvTemplatesIndex,
  getEnvTemplate,
  getEnvTemplateIfExists,
  envTemplatesIndexExists,
  createEnvTemplate,
  seedEnvTemplatesFromConfig,
  deleteEnvTemplate,
  disableEnvTemplate,
} from "@/lib/env-templates-store"

const stub = createS3Stub()

function useStub() {
  __testOnlySetS3(stub, TEST_BUCKET)
  stub.clear()
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const INDEX_KEY = "environment-templates/index.json"

function isDocKey(key: string): boolean {
  return key.startsWith("environment-templates/") && key.endsWith(".json") && key !== INDEX_KEY
}

export const tests = [
  {
    name: "envTemplatesStore: getEnvTemplatesIndex returns [] when index missing",
    fn: async () => {
      useStub()
      const index = await getEnvTemplatesIndex()
      assert(Array.isArray(index), "getEnvTemplatesIndex must return array")
      assert(index.length === 0, "index missing must return []")
    },
  },
  {
    name: "envTemplatesStore: getEnvTemplate throws for missing id",
    fn: async () => {
      useStub()
      try {
        await getEnvTemplate("__nonexistent__")
        throw new Error("Expected getEnvTemplate to throw for missing id")
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name
        assert(name === "NoSuchKey", `Expected NoSuchKey, got ${name}`)
      }
    },
  },
  {
    name: "envTemplatesStore: getEnvTemplateIfExists returns null for missing id",
    fn: async () => {
      useStub()
      const result = await getEnvTemplateIfExists("__nonexistent__")
      assert(result === null, "getEnvTemplateIfExists must return null for missing id")
    },
  },
  {
    name: "envTemplatesStore: envTemplatesIndexExists returns false when missing",
    fn: async () => {
      useStub()
      const exists = await envTemplatesIndexExists()
      assert(exists === false, "envTemplatesIndexExists must return false when index missing")
    },
  },
  {
    name: "envTemplatesStore: create writes doc first then index (docs-first ordering)",
    fn: async () => {
      useStub()
      await createEnvTemplate({
        label: "Test",
        modules: [{ module: "s3-bucket", order: 1 }],
        enabled: true,
      })
      const order = stub.getPutOrder()
      assert(order.length >= 2, "expect at least doc + index write")
      const lastIndexPos = order.findIndex((o) => o.key === INDEX_KEY)
      const docPositions = order
        .map((o, i) => (isDocKey(o.key) ? i : -1))
        .filter((i) => i >= 0)
      assert(lastIndexPos >= 0, "index must be written")
      for (const docPos of docPositions) {
        assert(docPos < lastIndexPos, `doc ${order[docPos]!.key} must be written before index`)
      }
    },
  },
  {
    name: "envTemplatesStore: seed writes docs first then index (docs-first ordering)",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([
        { id: "a1", label: "A1", modules: [] },
        { id: "a2", label: "A2", modules: [{ module: "s3-bucket", order: 1 }] },
      ])
      const order = stub.getPutOrder()
      const indexPos = order.findIndex((o) => o.key === INDEX_KEY)
      assert(indexPos >= 0, "index must be written")
      assert(order.length === 3, "expect 2 docs + 1 index")
      assert(order[0]!.key === "environment-templates/a1.json", "first write must be a1 doc")
      assert(order[1]!.key === "environment-templates/a2.json", "second write must be a2 doc")
      assert(order[2]!.key === INDEX_KEY, "last write must be index")
    },
  },
  {
    name: "envTemplatesStore: seed second run returns 409 (already initialized)",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([{ id: "x", label: "X", modules: [] }])
      try {
        await seedEnvTemplatesFromConfig([{ id: "y", label: "Y", modules: [] }])
        throw new Error("Expected seed to throw 409 on second run")
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        assert(code === "ENV_TEMPLATES_ALREADY_INITIALIZED", `Expected ENV_TEMPLATES_ALREADY_INITIALIZED, got ${code}`)
      }
    },
  },
  {
    name: "envTemplatesStore: DELETE soft disable sets enabled false",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([{ id: "soft", label: "Soft", modules: [] }])
      const afterDisable = await disableEnvTemplate("soft")
      assert(afterDisable.enabled === false, "disable must set enabled to false")
    },
  },
  {
    name: "envTemplatesStore: list flow skips missing docs (getEnvTemplateIfExists returns null)",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([{ id: "present", label: "Present", modules: [] }])
      const store = stub.getStore()
      const indexKey = `${TEST_BUCKET}/environment-templates/index.json`
      const indexJson = store.get(indexKey)
      assert(indexJson != null, "index must exist")
      const index = JSON.parse(indexJson!) as { id: string; label: string; enabled: boolean; updatedAt: string }[]
      index.push({ id: "orphan", label: "Orphan", enabled: true, updatedAt: new Date().toISOString() })
      store.set(indexKey, JSON.stringify(index))
      const idx = await getEnvTemplatesIndex()
      const enabled = idx.filter((e) => e.enabled)
      const templates = []
      for (const entry of enabled) {
        const doc = await getEnvTemplateIfExists(entry.id)
        if (doc) templates.push(doc)
      }
      assert(templates.length === 1, "list must skip orphan (missing doc)")
      assert(templates[0]!.id === "present", "list must include only present doc")
    },
  },
  {
    name: "envTemplatesStore: POST delete hard delete removes doc and index entry",
    fn: async () => {
      useStub()
      await seedEnvTemplatesFromConfig([{ id: "hard", label: "Hard", modules: [] }])
      await deleteEnvTemplate("hard")
      const index = await getEnvTemplatesIndex()
      assert(!index.some((e) => e.id === "hard"), "hard delete must remove from index")
      const doc = await getEnvTemplateIfExists("hard")
      assert(doc === null, "hard delete must remove doc")
    },
  },
]
