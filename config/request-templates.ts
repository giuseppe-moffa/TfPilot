/**
 * Request templates: environment + module (moduleKey) + default config.
 * Project is resolved at request time from user selection (Environment step 1);
 * repo/PR targeting uses that project.
 * Templates are loaded from GET /api/templates (S3 catalogue); this file only exports types and helpers.
 */

export type RequestTemplate = {
  id: string
  label: string
  description?: string
  /** e.g. ec2-instance; empty for Blank template */
  moduleKey: string
  environment: string
  /** When true, environment is locked (e.g. prod) */
  lockEnvironment?: boolean
  /** When true, Step 2 shows editable Project + Environment selectors (e.g. Blank template) */
  allowCustomProjectEnv?: boolean
  /** Partial config merged over module field defaults */
  defaultConfig: Record<string, unknown>
}

export function getRequestTemplate(
  templates: RequestTemplate[],
  id: string
): RequestTemplate | undefined {
  return templates.find((t) => t.id === id)
}

export function getTemplatesForModule(
  templates: RequestTemplate[],
  moduleKey: string
): RequestTemplate[] {
  return templates.filter((t) => t.moduleKey === moduleKey)
}
