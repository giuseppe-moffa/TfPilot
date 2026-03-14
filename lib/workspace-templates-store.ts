/**
 * S3-backed Workspace Template Store (Phase 1 — Template-Only Workspaces).
 *
 * Isolated subsystem that loads workspace templates from S3 only.
 * Layout: templates/workspaces/index.json, templates/workspaces/<templateId>/<version>.json
 * Bucket: TFPILOT_TEMPLATES_BUCKET
 *
 * Does NOT modify: workspace creation, deploy flows, request lifecycle, UI, or legacy template code.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"
import { validateTemplateDocument } from "@/lib/workspace-templates/validate"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_TEMPLATES_BUCKET

/** S3 key for the workspace templates index. */
export function workspaceTemplatesIndexKey(): string {
  return "templates/workspaces/index.json"
}

/** S3 key for a single workspace template document. */
export function workspaceTemplateDocumentKey(
  templateId: string,
  version: string
): string {
  return `templates/workspaces/${templateId}/${version}.json`
}

async function streamToString(stream: unknown): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const s = stream as { on(event: string, cb: (chunk?: Buffer) => void): void }
    s.on("data", (chunk?: Buffer) => {
      if (chunk) chunks.push(chunk)
    })
    s.on("error", reject)
    s.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

// --- Types ---

export type WorkspaceTemplateModule = {
  id: string
  source: string
  version: string
  config: Record<string, unknown>
}

export type WorkspaceTemplateInput = {
  key: string
  label: string
  type: "string" | "number" | "boolean"
  required?: boolean
  default?: unknown
}

export type WorkspaceTemplateDocument = {
  id: string
  name: string
  version: string
  modules: WorkspaceTemplateModule[]
  inputs?: WorkspaceTemplateInput[]
  description?: string
  category?: string
  icon?: string
  recommended?: boolean
}

export type WorkspaceTemplatesIndexEntry = {
  id: string
  name: string
  latest_version: string
  description?: string
  category?: string
  icon?: string
  recommended?: boolean
}

// --- Helpers ---

const DEBUG_TEMPLATES = process.env.TFPILOT_TEMPLATES_DEBUG === "true"

function isNoSuchKeyError(err: unknown): boolean {
  const e = err as { name?: string; Code?: string }
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey"
}

// --- Minimal validation (Phase 1: no full schema validation) ---

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function assertModuleShape(
  mod: unknown,
  index: number
): asserts mod is WorkspaceTemplateModule {
  if (!isRecord(mod)) {
    throw new Error(`Workspace template module at index ${index} must be an object`)
  }
  if (!isNonEmptyString(mod.id)) {
    throw new Error(
      `Workspace template module at index ${index} must have a non-empty string 'id'`
    )
  }
  if (!isNonEmptyString(mod.source)) {
    throw new Error(
      `Workspace template module at index ${index} must have a non-empty string 'source'`
    )
  }
  if (!isNonEmptyString(mod.version)) {
    throw new Error(
      `Workspace template module at index ${index} must have a non-empty string 'version'`
    )
  }
  if (mod.config !== undefined && !isRecord(mod.config)) {
    throw new Error(
      `Workspace template module at index ${index} must have 'config' as an object or omit it`
    )
  }
}

function assertTemplateDocumentShape(obj: unknown): asserts obj is WorkspaceTemplateDocument {
  if (!isRecord(obj)) {
    throw new Error("Workspace template document must be a JSON object")
  }
  if (!Array.isArray(obj.modules)) {
    throw new Error("Workspace template document must have a 'modules' array")
  }
  if (!isNonEmptyString(obj.id)) {
    throw new Error("Workspace template document must have a non-empty string 'id'")
  }
  if (!isNonEmptyString(obj.name)) {
    throw new Error("Workspace template document must have a non-empty string 'name'")
  }
  if (!isNonEmptyString(obj.version)) {
    throw new Error("Workspace template document must have a non-empty string 'version'")
  }
  obj.modules.forEach((mod, i) => assertModuleShape(mod, i))
}

// --- Test override (for unit tests only) ---

let _testIndexOverride: (() => Promise<WorkspaceTemplatesIndexEntry[]>) | null = null

/** @internal Test only: override getWorkspaceTemplatesIndex return value. */
export function __testOnlySetWorkspaceTemplatesIndex(
  fn: (() => Promise<WorkspaceTemplatesIndexEntry[]>) | null
): void {
  _testIndexOverride = fn
}

// --- Public API ---

/**
 * Reads templates/workspaces/index.json from S3.
 * Returns the list of template index entries (id, name, latest_version, etc.).
 * Throws if the index object does not exist (fail-loud: seed the bucket before use).
 */
export async function getWorkspaceTemplatesIndex(): Promise<
  WorkspaceTemplatesIndexEntry[]
> {
  if (_testIndexOverride) {
    return _testIndexOverride()
  }
  const key = workspaceTemplatesIndexKey()
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error("Workspace templates index must be a JSON array")
    }
    const entries = parsed as WorkspaceTemplatesIndexEntry[]
    const frozen = entries.map((e) => Object.freeze({ ...e }))
    if (DEBUG_TEMPLATES) {
      console.debug("[workspace-templates-store] index loaded", {
        key,
        count: frozen.length,
        ids: frozen.map((e) => e.id),
      })
    }
    return Object.freeze(frozen) as WorkspaceTemplatesIndexEntry[]
  } catch (err: unknown) {
    if (isNoSuchKeyError(err)) {
      throw new Error(
        `Workspace templates index not found (S3 key: ${key}). Seed the templates bucket before use.`
      )
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Workspace templates index: invalid JSON — ${err.message}`)
    }
    throw err
  }
}

/**
 * Reads templates/workspaces/<templateId>/<version>.json from S3.
 * Returns the template document. Throws on missing object or invalid JSON/shape.
 */
export async function getWorkspaceTemplate(
  templateId: string,
  version: string
): Promise<WorkspaceTemplateDocument> {
  const key = workspaceTemplateDocumentKey(templateId, version)
  let body: string
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    )
    body = await streamToString(res.Body)
  } catch (err: unknown) {
    if (isNoSuchKeyError(err)) {
      throw new Error(
        `Workspace template not found: ${templateId}@${version} (S3 key: ${key})`
      )
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    const msg = err instanceof SyntaxError ? err.message : String(err)
    throw new Error(
      `Workspace template invalid JSON: ${templateId}@${version} — ${msg}`
    )
  }

  assertTemplateDocumentShape(parsed)
  validateTemplateDocument(parsed)
  const doc = parsed as WorkspaceTemplateDocument
  const frozenModules = doc.modules.map((m) =>
    Object.freeze({
      ...m,
      config: Object.freeze((m.config ?? {}) as Record<string, unknown>),
    })
  )
  const frozenInputs =
    doc.inputs != null
      ? Object.freeze(
          doc.inputs.map((i) => Object.freeze({ ...i }))
        )
      : undefined
  const frozenDoc = Object.freeze({
    ...doc,
    modules: Object.freeze(frozenModules),
    ...(frozenInputs !== undefined && { inputs: frozenInputs }),
  })
  if (DEBUG_TEMPLATES) {
    console.debug("[workspace-templates-store] template loaded", {
      templateId: doc.id,
      version: doc.version,
      moduleCount: doc.modules.length,
    })
  }
  return frozenDoc as WorkspaceTemplateDocument
}

/**
 * Returns true if templates/workspaces/index.json exists in S3.
 * Used by seed route to avoid overwriting (idempotent guard).
 */
export async function workspaceTemplatesIndexExists(): Promise<boolean> {
  const key = workspaceTemplatesIndexKey()
  try {
    await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (err: unknown) {
    if (isNoSuchKeyError(err)) return false
    throw err
  }
}

/**
 * Seed workspace templates: write each document to S3, then write index.
 * Throws if index already exists (call workspaceTemplatesIndexExists first).
 * Layout: templates/workspaces/<id>/<version>.json, templates/workspaces/index.json.
 */
export async function seedWorkspaceTemplates(
  documents: WorkspaceTemplateDocument[]
): Promise<{ created: string[] }> {
  if (await workspaceTemplatesIndexExists()) {
    const err = new Error("WORKSPACE_TEMPLATES_ALREADY_INITIALIZED") as Error & { code?: string }
    err.code = "WORKSPACE_TEMPLATES_ALREADY_INITIALIZED"
    throw err
  }
  const created: string[] = []
  const indexById = new Map<string, WorkspaceTemplatesIndexEntry>()

  for (const doc of documents) {
    if (!doc.id?.trim() || !doc.version?.trim()) continue
    const id = doc.id.trim()
    const version = doc.version.trim()
    const key = workspaceTemplateDocumentKey(id, version)
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(doc, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      })
    )
    if (!created.includes(id)) created.push(id)
    indexById.set(id, {
      id,
      name: doc.name ?? id,
      latest_version: version,
      description: doc.description,
      category: doc.category,
      icon: doc.icon,
      recommended: doc.recommended,
    })
  }

  const indexKey = workspaceTemplatesIndexKey()
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: indexKey,
      Body: JSON.stringify(Array.from(indexById.values()), null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return { created }
}

// --- Seed support (example for later seed route) ---
//
// Example template document for baseline-app v1. Use this shape when implementing
// a seed route or manual S3 upload. S3 path: templates/workspaces/baseline-app/v1.json
//
// export const EXAMPLE_WORKSPACE_TEMPLATE_BASELINE_APP_V1: WorkspaceTemplateDocument = {
//   id: "baseline-app",
//   name: "Baseline App",
//   version: "v1",
//   description: "Minimal baseline with VPC module",
//   category: "networking",
//   modules: [
//     {
//       id: "vpc",
//       source: "terraform-aws-modules/vpc/aws",
//       version: "5.1.0",
//       config: {},
//     },
//   ],
//   inputs: [
//     {
//       key: "environment",
//       label: "Environment",
//       type: "string",
//       required: true,
//     },
//   ],
// }
