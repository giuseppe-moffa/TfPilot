import crypto from "node:crypto"

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 * Uses HMAC SHA256 and constant-time comparison to avoid timing attacks.
 *
 * @param rawBody - Exact request body as string (must not be parsed/modified)
 * @param signatureHeader - Value of X-Hub-Signature-256 header (e.g. "sha256=...")
 * @param secret - Webhook secret configured in GitHub
 * @returns true if signature is valid
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false
  const prefix = "sha256="
  if (!signatureHeader.startsWith(prefix)) return false
  const expectedHex = signatureHeader.slice(prefix.length).trim()
  if (!expectedHex || expectedHex.length !== 64) return false

  const hmac = crypto.createHmac("sha256", secret)
  hmac.update(rawBody, "utf8")
  const computed = hmac.digest("hex")
  return timingSafeEqual(computed, expectedHex)
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}
