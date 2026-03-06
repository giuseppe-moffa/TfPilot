import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import crypto from "node:crypto"
import { moduleRegistry } from "@/config/module-registry"
import { env } from "@/lib/config/env"

export const ENV_TEMPLATE_VALIDATION_FAILED = "ENV_TEMPLATE_VALIDATION_FAILED"

function envTemplateValidationError(): never {
  const err = new Error(ENV_TEMPLATE_VALIDATION_FAILED) as Error & { code?: string }
  err.code = ENV_TEMPLATE_VALIDATION_FAILED
  throw err
}

const ALLOWED_TOP_LEVEL = new Set(["id", "label", "description", "modules", "enabled"])
const MAX_MODULES = 50
const MAX_DEFAULT_CONFIG_KEYS = 100
const MAX_VALUE_BYTES = 10 * 1024

function validateNoUnknownTopLevel(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL.has(k)) envTemplateValidationError()
  }
}

function validateModules(
  modules: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
): void {
  if (!Array.isArray(modules)) envTemplateValidationError()
  if (modules.length > MAX_MODULES) envTemplateValidationError()
  for (const mod of modules) {
    if (typeof mod.module !== "string" || typeof mod.order !== "number")
      envTemplateValidationError()
    const regEntry = moduleRegistry.find((m) => m.type === mod.module)
    if (!regEntry) envTemplateValidationError()
    const validKeys = new Set(regEntry.fields.map((f) => f.name))
    const dc = mod.defaultConfig
    if (dc && typeof dc === "object" && !Array.isArray(dc)) {
      const keys = Object.keys(dc)
      if (keys.length > MAX_DEFAULT_CONFIG_KEYS) envTemplateValidationError()
      for (const k of keys) {
        if (!validKeys.has(k)) envTemplateValidationError()
        const v = dc[k]
        if (v !== null && v !== undefined) {
          const s = JSON.stringify(v)
          if (Buffer.byteLength(s, "utf8") > MAX_VALUE_BYTES) envTemplateValidationError()
        }
      }
    }
  }
}

let _s3Override: S3Client | { send: (cmd: unknown) => Promise<unknown> } | null = null
let _bucketOverride: string | null = null

/**
 * Test-only: inject S3 client and bucket for deterministic tests.
 * Not imported by any prod code; tree-shake safe. Do not add to barrel exports.
 */
export function __testOnlySetS3(
  client: { send: (cmd: unknown) => Promise<unknown> } | null,
  bucket?: string | null
) {
  _s3Override = client
  _bucketOverride = bucket ?? null
}

function getS3(): S3Client | { send: (cmd: unknown) => Promise<unknown> } {
  return _s3Override ?? new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
}

function getBucket(): string {
  return _bucketOverride ?? env.TFPILOT_TEMPLATES_BUCKET
}

const PREFIX = "environment-templates/"

function indexKey(orgId: string): string {
  return `${PREFIX}${orgId}/index.json`
}
function templateKey(orgId: string, id: string): string {
  return `${PREFIX}${orgId}/${id}.json`
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

export type EnvTemplateIndexEntry = {
  id: string
  label: string
  enabled: boolean
  updatedAt: string
  /** Incremented on each update; 1 on create. */
  version?: number
}

export type StoredEnvTemplate = {
  id: string
  label?: string
  description?: string
  modules: {
    module: string
    order: number
    defaultConfig?: Record<string, unknown>
  }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** Incremented on each update; 1 on create. Missing on legacy objects (treated as 1). */
  version?: number
}

export type CreateEnvTemplatePayload = Omit<
  StoredEnvTemplate,
  "id" | "createdAt" | "updatedAt" | "version"
>
export type UpdateEnvTemplatePayload = Partial<
  Omit<StoredEnvTemplate, "id" | "createdAt" | "updatedAt" | "version">
>

function shortId(): string {
  const alphabet = "abcdefghjklmnpqrstuvwxyz23456789"
  const bytes = crypto.randomBytes(6)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

function slugFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "template"
}

function generateId(label: string, existingIds: Set<string>): string {
  const base = slugFromLabel(label)
  let id = `${base}-${shortId()}`
  let attempts = 0
  while (existingIds.has(id) && attempts < 20) {
    id = `${base}-${shortId()}`
    attempts++
  }
  return id
}

/** Ensures index entries always have a non-empty label. */
function effectiveLabel(label: string | undefined, fallback: string): string {
  return (label?.trim() || fallback)
}

/**
 * Check if environment-templates/<org_id>/index.json exists. Use for seed guard only.
 * getEnvTemplatesIndex() returns [] on NoSuchKey — do not use that to infer "not initialized".
 */
export async function envTemplatesIndexExists(orgId: string): Promise<boolean> {
  try {
    await getS3().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: indexKey(orgId) })
    )
    return true
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return false
    throw err
  }
}

/**
 * Read environment-templates/<org_id>/index.json. Returns [] if the key does not exist.
 */
export async function getEnvTemplatesIndex(orgId: string): Promise<EnvTemplateIndexEntry[]> {
  try {
    const res = (await getS3().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: indexKey(orgId) })
    )) as { Body?: unknown }
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : []
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return []
    throw err
  }
}

/**
 * Read a single env template by id. Throws if not found (NoSuchKey).
 *
 * For list flows that iterate index and fetch docs: use {@link getEnvTemplateIfExists}
 * instead. If it returns null, skip the item, log a warning, and continue.
 * Do not call getEnvTemplate in a loop—it will throw and crash the request.
 */
export async function getEnvTemplate(orgId: string, id: string): Promise<StoredEnvTemplate> {
  const key = templateKey(orgId, id)
  const res = (await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }))) as { Body?: unknown }
  const body = await streamToString(res.Body)
  return JSON.parse(body) as StoredEnvTemplate
}

/**
 * Read a single env template by id. Returns null if not found (NoSuchKey).
 * Use this when iterating the index for list/admin endpoints: on null, skip item,
 * log warn (e.g. "[env-templates] missing doc for id"), and continue.
 */
export async function getEnvTemplateIfExists(
  orgId: string,
  id: string
): Promise<StoredEnvTemplate | null> {
  try {
    return await getEnvTemplate(orgId, id)
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}

/**
 * Create a new env template: generate id, write doc first, then append to index.
 */
export async function createEnvTemplate(
  orgId: string,
  payload: CreateEnvTemplatePayload
): Promise<StoredEnvTemplate> {
  validateNoUnknownTopLevel(payload as Record<string, unknown>)
  validateModules(payload.modules ?? [])
  const index = await getEnvTemplatesIndex(orgId)
  const existingIds = new Set(index.map((e) => e.id))
  const id = generateId(payload.label ?? "template", existingIds)
  const now = new Date().toISOString()
  const label = effectiveLabel(payload.label, id)
  const template: StoredEnvTemplate = {
    ...payload,
    id,
    label,
    modules: payload.modules ?? [],
    enabled: payload.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: templateKey(orgId, id),
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const entry: EnvTemplateIndexEntry = {
    id,
    label,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: template.version,
  }
  const newIndex = [...index, entry]
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: indexKey(orgId),
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Create an env template with a specific id (for migration/seed). Throws if id already exists.
 */
export async function createEnvTemplateWithId(
  orgId: string,
  id: string,
  payload: CreateEnvTemplatePayload
): Promise<StoredEnvTemplate> {
  validateNoUnknownTopLevel(payload as Record<string, unknown>)
  validateModules(payload.modules ?? [])
  const index = await getEnvTemplatesIndex(orgId)
  if (index.some((e) => e.id === id)) {
    throw new Error(`Env template with id "${id}" already exists`)
  }
  const now = new Date().toISOString()
  const label = effectiveLabel(payload.label, id)
  const template: StoredEnvTemplate = {
    ...payload,
    id,
    label,
    modules: payload.modules ?? [],
    enabled: payload.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: templateKey(orgId, id),
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const entry: EnvTemplateIndexEntry = {
    id,
    label,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: 1,
  }
  const newIndex = [...index, entry]
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: indexKey(orgId),
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Update an existing env template and refresh index entry. Increments version.
 */
export async function updateEnvTemplate(
  orgId: string,
  id: string,
  partial: UpdateEnvTemplatePayload
): Promise<StoredEnvTemplate> {
  validateNoUnknownTopLevel(partial as Record<string, unknown>)
  const current = await getEnvTemplate(orgId, id)
  const now = new Date().toISOString()
  const nextVersion = (current.version ?? 1) + 1
  const merged = {
    ...current,
    ...partial,
    id,
    createdAt: current.createdAt,
    updatedAt: now,
    version: nextVersion,
  }
  const label = effectiveLabel(merged.label, id)
  const modules = merged.modules ?? current.modules
  validateModules(modules)
  const template: StoredEnvTemplate = {
    ...merged,
    label,
    modules,
  }
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: templateKey(orgId, id),
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const index = await getEnvTemplatesIndex(orgId)
  const entry: EnvTemplateIndexEntry = {
    id,
    label,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: nextVersion,
  }
  const newIndex = index.map((e) => (e.id === id ? entry : e))
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: indexKey(orgId),
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Soft disable: set enabled to false. Increments version.
 */
export async function disableEnvTemplate(
  orgId: string,
  id: string
): Promise<StoredEnvTemplate> {
  return updateEnvTemplate(orgId, id, { enabled: false })
}

/**
 * Re-enable an env template. Increments version.
 */
export async function enableEnvTemplate(
  orgId: string,
  id: string
): Promise<StoredEnvTemplate> {
  return updateEnvTemplate(orgId, id, { enabled: true })
}

/** Seed input shape (from config/environment-templates.ts). */
export type EnvTemplateSeedInput = {
  id: string
  label?: string
  description?: string
  modules?: { module: string; order: number; defaultConfig?: Record<string, unknown> }[]
}

/**
 * Seed env templates from config. Writes docs first, then index (per delta invariant).
 * Throws if index already exists (ENV_TEMPLATES_ALREADY_INITIALIZED).
 */
export async function seedEnvTemplatesFromConfig(
  orgId: string,
  templates: EnvTemplateSeedInput[]
): Promise<{ created: string[] }> {
  if (await envTemplatesIndexExists(orgId)) {
    const err = new Error("ENV_TEMPLATES_ALREADY_INITIALIZED") as Error & { code?: string }
    err.code = "ENV_TEMPLATES_ALREADY_INITIALIZED"
    throw err
  }
  const created: string[] = []
  const now = new Date().toISOString()
  const index: EnvTemplateIndexEntry[] = []

  for (const t of templates) {
    validateNoUnknownTopLevel(t as Record<string, unknown>)
    validateModules(t.modules ?? [])
    const label = effectiveLabel(t.label, t.id)
    const template: StoredEnvTemplate = {
      id: t.id,
      label,
      description: typeof t.description === "string" ? t.description : undefined,
      modules: t.modules ?? [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    await getS3().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: templateKey(orgId, t.id),
        Body: JSON.stringify(template, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      })
    )
    created.push(t.id)
    index.push({
      id: t.id,
      label,
      enabled: true,
      updatedAt: now,
      version: 1,
    })
  }

  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: indexKey(orgId),
      Body: JSON.stringify(index, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return { created }
}

/**
 * Hard delete: remove doc from S3 and remove entry from index. (Soft disable
 * is via disableEnvTemplate; admin DELETE route calls that, not this.)
 */
export async function deleteEnvTemplate(orgId: string, id: string): Promise<void> {
  const index = await getEnvTemplatesIndex(orgId)
  const newIndex = index.filter((e) => e.id !== id)
  if (newIndex.length === index.length) {
    const err = new Error("Not found") as Error & { name?: string }
    err.name = "NoSuchKey"
    throw err
  }
  await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: templateKey(orgId, id) }))
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: indexKey(orgId),
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}
