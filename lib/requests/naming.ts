const MAX_LEN = 63
const NAME_REGEX = /^[a-zA-Z0-9-]{3,63}$/

function slugify(value: string) {
  return value
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function shortCodeFromRequestId(requestId: string) {
  const parts = requestId.split("_")
  const tail = parts[parts.length - 1] || requestId
  return slugify(tail)
}

export function buildResourceName(base: string, requestId: string) {
  const safeBase = slugify(base.trim())
  const short = shortCodeFromRequestId(requestId)
  const suffix = `-${short}`
  const available = MAX_LEN - suffix.length
  const trimmedBase = safeBase.slice(0, Math.max(0, available)).replace(/-+$/, "") || safeBase

  let candidate = `${trimmedBase}${suffix}`
  if (candidate.length > MAX_LEN) {
    candidate = candidate.slice(0, MAX_LEN).replace(/-+$/, "")
  }
  return candidate
}

export function validateResourceName(name: string) {
  return NAME_REGEX.test(name)
}

export function effectiveName(base: string, requestId: string | null | undefined) {
  if (!requestId) return `${base}-<requestId>`
  return buildResourceName(base, requestId)
}
