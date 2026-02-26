/**
 * Shared resource name validation for all modules (s3-bucket, ec2-instance, ecr-repo, etc.).
 * Rules: 3–63 chars, lowercase alphanumeric and hyphen, no leading/trailing hyphen, no "--".
 */

/** Lowercase and trim. */
export function normalizeName(input: string): string {
  return (input ?? "").trim().toLowerCase()
}

/**
 * Full resource name (e.g. after suffix is appended): 3–63 chars,
 * ^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$, and must not contain "--".
 */
const RESOURCE_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/

export function validateResourceName(name: string): { ok: true } | { ok: false; error: string } {
  const n = normalizeName(name)
  if (!n) {
    return { ok: false, error: "Name is required." }
  }
  if (n.includes("--")) {
    return { ok: false, error: "Name must not contain consecutive hyphens." }
  }
  if (n.length < 3) {
    return { ok: false, error: "Name must be at least 3 characters." }
  }
  if (n.length > 63) {
    return { ok: false, error: "Name must be at most 63 characters." }
  }
  if (!RESOURCE_NAME_REGEX.test(n)) {
    return {
      ok: false,
      error: "Name must be lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.",
    }
  }
  return { ok: true }
}

/** Max length for base name so that base + "-" + 6-char suffix <= 63. */
const MAX_BASE_LENGTH = 56

/**
 * Base name (before suffix) for UI: 1–56 chars, same charset rules, no "--", no leading/trailing hyphen.
 * Use in create/edit flows where the server will append the request-id suffix.
 */
const BASE_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,54})[a-z0-9]$/
const BASE_NAME_1_2_CHARS = /^[a-z0-9]{1,2}$/

export function validateBaseResourceName(base: string): { ok: true } | { ok: false; error: string } {
  const n = normalizeName(base)
  if (!n) {
    return { ok: false, error: "Name is required." }
  }
  if (n.includes("--")) {
    return { ok: false, error: "Name must not contain consecutive hyphens." }
  }
  if (n.length > MAX_BASE_LENGTH) {
    return {
      ok: false,
      error: `Name must be at most ${MAX_BASE_LENGTH} characters (a suffix will be added).`,
    }
  }
  if (n.length <= 2) {
    if (!BASE_NAME_1_2_CHARS.test(n)) {
      return { ok: false, error: "Name must be lowercase letters and numbers only." }
    }
    return { ok: true }
  }
  if (!BASE_NAME_REGEX.test(n)) {
    return {
      ok: false,
      error: "Name must be lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.",
    }
  }
  return { ok: true }
}
