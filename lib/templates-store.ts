import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import crypto from "node:crypto"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_TEMPLATES_BUCKET
const PREFIX = "templates/"
const INDEX_KEY = `${PREFIX}index.json`

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

export type TemplateIndexEntry = {
  id: string
  label: string
  /** Empty string means "any project" (template usable for any project). */
  project: string
  environment: string
  module: string
  enabled: boolean
  updatedAt: string
  /** Incremented on each update; 1 on create. */
  version?: number
}

export type StoredTemplate = {
  id: string
  label: string
  description?: string
  /** Empty string means "any project" (template usable for any project). */
  project: string
  environment: string
  module: string
  defaultConfig: Record<string, unknown>
  uiSchema?: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** Incremented on each update; 1 on create. Missing on legacy objects (treated as 1). */
  version?: number
  /** Email of user who created the template (audit). */
  createdBy?: string | null
  /** Email of user who last updated the template (audit). */
  updatedBy?: string | null
  lockEnvironment?: boolean
  allowCustomProjectEnv?: boolean
}

export type CreateTemplatePayload = Omit<
  StoredTemplate,
  "id" | "createdAt" | "updatedAt" | "version" | "createdBy" | "updatedBy"
>
export type UpdateTemplatePayload = Partial<
  Omit<StoredTemplate, "id" | "createdAt" | "updatedAt" | "version">
>

/** Keys that are set per request (user/flow), not from template defaultConfig. */
const REQUEST_DERIVED_CONFIG_KEYS = new Set([
  "name",
  "project",
  "environment",
  "request_id",
])

function sanitizeTemplateDefaultConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (!REQUEST_DERIVED_CONFIG_KEYS.has(k)) out[k] = v
  }
  return out
}

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

/**
 * Read templates/index.json. Returns [] if the key does not exist.
 */
export async function getTemplatesIndex(): Promise<TemplateIndexEntry[]> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY })
    )
    const body = await streamToString(res.Body)
    const parsed = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : []
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === "NoSuchKey") return []
    throw err
  }
}

/**
 * Read a single template by id. Throws if not found.
 */
export async function getTemplate(id: string): Promise<StoredTemplate> {
  const key = `${PREFIX}${id}.json`
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const body = await streamToString(res.Body)
  return JSON.parse(body) as StoredTemplate
}

/**
 * Create a new template: generate id, write template file, append to index.
 * @param createdBy - Email of the creating user (audit).
 */
export async function createTemplate(
  payload: CreateTemplatePayload,
  createdBy?: string | null
): Promise<StoredTemplate> {
  const index = await getTemplatesIndex()
  const existingIds = new Set(index.map((e) => e.id))
  const id = generateId(payload.label, existingIds)
  const now = new Date().toISOString()
  const template: StoredTemplate = {
    ...payload,
    id,
    createdAt: now,
    updatedAt: now,
    version: 1,
    createdBy: createdBy ?? null,
    updatedBy: createdBy ?? null,
    defaultConfig: sanitizeTemplateDefaultConfig(payload.defaultConfig ?? {}),
  }
  const key = `${PREFIX}${id}.json`
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const entry: TemplateIndexEntry = {
    id,
    label: template.label,
    project: template.project,
    environment: template.environment,
    module: template.module,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: template.version,
  }
  const newIndex = [...index, entry]
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: INDEX_KEY,
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Create a template with a specific id (for migration/seed). Throws if id already exists.
 */
export async function createTemplateWithId(
  id: string,
  payload: CreateTemplatePayload
): Promise<StoredTemplate> {
  const index = await getTemplatesIndex()
  if (index.some((e) => e.id === id)) {
    throw new Error(`Template with id "${id}" already exists`)
  }
  const now = new Date().toISOString()
  const template: StoredTemplate = {
    ...payload,
    id,
    createdAt: now,
    updatedAt: now,
    version: 1,
    createdBy: null,
    updatedBy: null,
    defaultConfig: sanitizeTemplateDefaultConfig(payload.defaultConfig ?? {}),
  }
  const key = `${PREFIX}${id}.json`
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const entry: TemplateIndexEntry = {
    id,
    label: template.label,
    project: template.project,
    environment: template.environment,
    module: template.module,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: 1,
  }
  const newIndex = [...index, entry]
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: INDEX_KEY,
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Update an existing template and refresh index entry. Increments version.
 * @param partial - updatedBy should be set by caller (API) from session email.
 */
export async function updateTemplate(
  id: string,
  partial: UpdateTemplatePayload
): Promise<StoredTemplate> {
  const current = await getTemplate(id)
  const now = new Date().toISOString()
  const nextVersion = (current.version ?? 1) + 1
  const merged = {
    ...current,
    ...partial,
    id,
    createdAt: current.createdAt,
    updatedAt: now,
    version: nextVersion,
    createdBy: current.createdBy ?? undefined,
    updatedBy: partial.updatedBy ?? current.updatedBy ?? undefined,
  }
  const template: StoredTemplate = {
    ...merged,
    defaultConfig: sanitizeTemplateDefaultConfig(merged.defaultConfig ?? {}),
  }
  const key = `${PREFIX}${id}.json`
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(template, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  const index = await getTemplatesIndex()
  const entry: TemplateIndexEntry = {
    id,
    label: template.label,
    project: template.project,
    environment: template.environment,
    module: template.module,
    enabled: template.enabled,
    updatedAt: template.updatedAt,
    version: nextVersion,
  }
  const newIndex = index.map((e) => (e.id === id ? entry : e))
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: INDEX_KEY,
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
  return template
}

/**
 * Soft disable: set enabled to false. Increments version and sets updatedBy.
 */
export async function disableTemplate(
  id: string,
  updatedBy?: string | null
): Promise<StoredTemplate> {
  return updateTemplate(id, { enabled: false, updatedBy: updatedBy ?? undefined })
}

/**
 * Re-enable a template. Increments version and sets updatedBy.
 */
export async function enableTemplate(
  id: string,
  updatedBy?: string | null
): Promise<StoredTemplate> {
  return updateTemplate(id, { enabled: true, updatedBy: updatedBy ?? undefined })
}

/**
 * Permanently delete a template: remove from index and delete object from S3.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const index = await getTemplatesIndex()
  const newIndex = index.filter((e) => e.id !== id)
  if (newIndex.length === index.length) {
    const err = new Error("Not found") as Error & { name?: string }
    err.name = "NoSuchKey"
    throw err
  }
  const key = `${PREFIX}${id}.json`
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: INDEX_KEY,
      Body: JSON.stringify(newIndex, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  )
}
