/**
 * Audit: identify requests missing any of environment_id, environment_key, environment_slug.
 */

export function isMissingEnvField(req: Record<string, unknown>): boolean {
  const id = req.environment_id
  const key = req.environment_key
  const slug = req.environment_slug ?? ""
  return !id || !key || String(slug).trim() === ""
}

export function getRequestIdsMissingEnv(requests: Array<{ id: string } & Record<string, unknown>>): string[] {
  return requests.filter((r) => isMissingEnvField(r)).map((r) => r.id)
}
