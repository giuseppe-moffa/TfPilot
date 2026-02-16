function toSnakeCase(key: string) {
  return key.replace(/([A-Z])/g, "_$1").replace(/-/g, "_").toLowerCase()
}

type Policy = {
  nameRegex: string
  allowedRegions: string[]
}

export function normalizeConfigKeys(raw: Record<string, any> = {}) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    const snake = toSnakeCase(k)
    out[snake] = v
  }
  return out
}

export function sanitizeConfig(
  config: Record<string, any>,
  policy?: Policy | null,
  requestId?: string | null,
  module?: string | null,
  allowedFields?: string[] | null
) {
  const cleaned: Record<string, any> = { ...config }
  const nameFields = ["name", "bucket_name", "queue_name", "service_name"]
  for (const field of nameFields) {
    if (field in cleaned) {
      const userValue = enforceNaming(cleaned[field]) ?? undefined
      if (userValue) {
        cleaned[field] = userValue
      }
    }
  }
  const boolFields = ["block_public_access", "versioning_enabled", "enable_lifecycle", "force_destroy"]
  for (const key of boolFields) {
    if (key in cleaned) {
      const v = cleaned[key]
      if (typeof v === "string") {
        const t = v.trim().toLowerCase()
        if (["true", "1", "yes", "on"].includes(t)) cleaned[key] = true
        else if (["false", "0", "no", "off"].includes(t)) cleaned[key] = false
      }
      if (typeof cleaned[key] !== "boolean") {
        delete cleaned[key]
      }
    }
  }
  if (cleaned.versioning_enabled === undefined && typeof (cleaned as any).versioning !== "undefined") {
    cleaned.versioning_enabled = (cleaned as any).versioning
    delete (cleaned as any).versioning
  }
  if (cleaned.versioning_enabled === undefined && typeof (cleaned as any).version !== "undefined") {
    cleaned.versioning_enabled = (cleaned as any).version
    delete (cleaned as any).version
  }
  if (policy?.allowedRegions?.length === 1) {
    const region = policy.allowedRegions[0]
    if (!cleaned.aws_region && !cleaned.region) {
      cleaned.aws_region = region
    }
  }
  if (!cleaned.name && typeof cleaned.bucket_name === "string" && cleaned.bucket_name.trim()) {
    cleaned.name = cleaned.bucket_name
  }

  delete cleaned.name_base
  delete cleaned.public_read_access
  delete cleaned.sse_s3_enabled
  delete cleaned.access_logging_enabled
  delete cleaned.lifecycle_rules_enabled
  delete cleaned.base_name
  delete (cleaned as any).baseName
  delete (cleaned as any).bucket_base_name
  delete (cleaned as any).bucketBaseName

  const allowed = allowedFields ? new Set(allowedFields) : null
  if (module && allowed) {
    for (const key of Object.keys(cleaned)) {
      if (!allowed.has(key)) {
        delete cleaned[key]
      }
    }
  }

  return cleaned
}

function enforceNaming(value?: string | null) {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^[a-zA-Z0-9-]{3,63}$/.test(trimmed) ? trimmed : null
}
