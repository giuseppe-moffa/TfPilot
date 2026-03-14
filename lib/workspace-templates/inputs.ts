/**
 * Phase 3 — Template input resolution and validation.
 *
 * Resolves submitted template_inputs against template schema: validate types,
 * apply defaults, reject unknown keys. Does not mutate submitted input.
 */

import type { WorkspaceTemplateDocument } from "@/lib/workspace-templates-store"

const INPUT_TYPES = ["string", "number", "boolean"] as const
type InputType = (typeof INPUT_TYPES)[number]

function isInputType(t: string): t is InputType {
  return INPUT_TYPES.includes(t as InputType)
}

function typeMatches(
  type: InputType,
  value: unknown
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number"
    case "boolean":
      return typeof value === "boolean"
    default:
      return false
  }
}

/**
 * Resolves and validates submitted template inputs against the template schema.
 * Returns a record of only declared keys with validated values and defaults applied.
 * Does not mutate `submitted`. submitted === undefined or null behaves exactly like {}.
 *
 * - If template.inputs is omitted or empty, returns {}.
 * - For each declared input: use submitted value (if valid type), else default, else throw if required.
 * - Rejects unknown keys in submitted (throws "Unknown template input 'key'").
 * - Clear errors: "Missing required template input 'key'", "Invalid value for template input 'key': expected number", "Unknown template input 'key'".
 */
export function resolveTemplateInputs(
  template: WorkspaceTemplateDocument,
  submitted: Record<string, unknown> | undefined
): Record<string, unknown> {
  const raw =
    submitted != null && typeof submitted === "object" && !Array.isArray(submitted)
      ? submitted
      : {}

  const inputs = template.inputs
  if (!inputs || inputs.length === 0) {
    if (Object.keys(raw).length > 0) {
      const unknown = Object.keys(raw)[0]
      throw new Error(`Unknown template input '${unknown}'`)
    }
    return {}
  }

  const declaredKeys = new Set(inputs.map((i) => i.key))

  for (const key of Object.keys(raw)) {
    if (!declaredKeys.has(key)) {
      throw new Error(`Unknown template input '${key}'`)
    }
  }

  const out: Record<string, unknown> = {}
  for (const input of inputs) {
    const key = input.key
    const type = input.type as InputType
    if (!isInputType(type)) continue
    const submittedVal = raw[key]
    const hasSubmitted = key in raw

    if (hasSubmitted && submittedVal !== undefined) {
      if (!typeMatches(type, submittedVal)) {
        throw new Error(
          `Invalid value for template input '${key}': expected ${type}`
        )
      }
      out[key] = submittedVal
      continue
    }
    if (input.default !== undefined) {
      out[key] = input.default
      continue
    }
    if (input.required === true) {
      throw new Error(`Missing required template input '${key}'`)
    }
    // optional, no default, not provided → omit from output (or could include undefined; schema says "only declared keys", so we omit)
  }
  return out
}
