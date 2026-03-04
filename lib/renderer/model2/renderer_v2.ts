/**
 * Model 2 renderer — one file per request, no marker-based splice.
 * Staged for Phase 3 cutover — not used by request routes until atomic flip.
 * Output: envs/<key>/<slug>/tfpilot/requests/<module>_req_<request_id>.tf with module source ../../../modules/<module>.
 */

import { computeRequestTfPath, getModuleSourceV2 } from "./paths"

export type RequestForRender = {
  id: string
  module: string
  config: Record<string, unknown>
}

function renderHclValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (Array.isArray(value) || typeof value === "object") {
    return `jsonencode(${JSON.stringify(value)})`
  }
  return `"${String(value)}"`
}

function hclTagKey(key: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return key
  return `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Renders the HCL module block for a request. Uses locked module source depth ../../../modules/<module>. */
export function renderModuleBlockV2(request: RequestForRender): string {
  const moduleSource = getModuleSourceV2(request.module)
  const renderedInputs = Object.entries(request.config).map(([key, val]) => {
    if (key === "tags" && val && typeof val === "object" && !Array.isArray(val)) {
      const tagEntries = Object.entries(val as Record<string, unknown>).map(
        ([k, v]) => `    ${hclTagKey(k)} = ${renderHclValue(v)}`
      )
      return `  tags = {\n${tagEntries.join("\n")}\n  }`
    }
    return `  ${key} = ${renderHclValue(val)}`
  })

  const safeModuleName = `tfpilot_${request.id}`.replace(/[^a-zA-Z0-9_]/g, "_")

  return `module "${safeModuleName}" {
  source = "${moduleSource}"
${renderedInputs.join("\n")}
}`
}

/** Returns full .tf file content for a request — one file per request, no markers. */
export function renderRequestTfContent(request: RequestForRender): string {
  const header = "# Managed by TfPilot - do not edit by hand."
  const block = renderModuleBlockV2(request)
  return `${header}\n\n${block}\n`
}

/** Generates the single file to write for Model 2. Pure, no I/O. */
export function generateModel2RequestFile(
  environment_key: string,
  environment_slug: string,
  request: RequestForRender
): { path: string; content: string } {
  const path = computeRequestTfPath(environment_key, environment_slug, request.module, request.id)
  const content = renderRequestTfContent(request)
  return { path, content }
}
