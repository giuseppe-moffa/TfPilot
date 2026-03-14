/**
 * Phase 2 — Template Validation Layer.
 *
 * Validates workspace template documents and input schemas.
 * Does not mutate the template. Throws clear errors on invalid structure.
 *
 * Rules:
 * - inputs: may be omitted or an array (possibly empty). Empty array means no template inputs.
 * - version: format (e.g. semver) may be validated in a later phase; currently only non-empty string.
 */

import type { WorkspaceTemplateDocument } from "@/lib/workspace-templates-store"

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function prefix(template: Record<string, unknown>): string {
  const id = template.id
  const version = template.version
  if (typeof id === "string" && id.length > 0 && typeof version === "string" && version.length > 0) {
    return `Invalid workspace template ${id}@${version}:`
  }
  return "Invalid workspace template:"
}

function validateModule(mod: unknown, index: number, msgPrefix: string): void {
  if (!isRecord(mod)) {
    throw new Error(`${msgPrefix} module at index ${index} must be an object`)
  }
  if (!nonEmptyString(mod.id)) {
    throw new Error(`${msgPrefix} module at index ${index} must have a non-empty string 'id'`)
  }
  if (!nonEmptyString(mod.source)) {
    throw new Error(`${msgPrefix} module at index ${index} must have a non-empty string 'source'`)
  }
  if (!nonEmptyString(mod.version)) {
    throw new Error(`${msgPrefix} module at index ${index} must have a non-empty string 'version'`)
  }
  if (!isRecord(mod.config)) {
    throw new Error(
      `${msgPrefix} module at index ${index} must have 'config' as an object`
    )
  }
}

function validateInput(input: unknown, index: number, msgPrefix: string): void {
  if (!isRecord(input)) {
    throw new Error(`${msgPrefix} input at index ${index} must be an object`)
  }
  if (!nonEmptyString(input.key)) {
    throw new Error(`${msgPrefix} input at index ${index} must have a non-empty string 'key'`)
  }
  if (!nonEmptyString(input.label)) {
    throw new Error(`${msgPrefix} input at index ${index} must have a non-empty string 'label'`)
  }
  const typeVal = input.type
  if (typeVal !== "string" && typeVal !== "number" && typeVal !== "boolean") {
    throw new Error(
      `${msgPrefix} input at index ${index} has unsupported type '${String(typeVal)}'; must be one of: string, number, boolean`
    )
  }
  const required = input.required
  if (required !== undefined && typeof required !== "boolean") {
    throw new Error(`${msgPrefix} input at index ${index} must have 'required' as a boolean or omit it`)
  }
  const defaultVal = input.default
  if (defaultVal !== undefined) {
    const matchesType =
      (typeVal === "string" && typeof defaultVal === "string") ||
      (typeVal === "number" && typeof defaultVal === "number") ||
      (typeVal === "boolean" && typeof defaultVal === "boolean")
    if (!matchesType) {
      throw new Error(
        `${msgPrefix} input at index ${index} 'default' must match type '${typeVal}'`
      )
    }
  }
  if (required === true && defaultVal !== undefined) {
    throw new Error(
      `${msgPrefix} input at index ${index} cannot have both required: true and a default value`
    )
  }
}

/**
 * Validates a workspace template document. Does not mutate the template.
 * Throws with a clear message (e.g. "Invalid workspace template baseline-app@v1: modules array must not be empty") on failure.
 */
export function validateTemplateDocument(template: unknown): asserts template is WorkspaceTemplateDocument {
  if (!isRecord(template)) {
    throw new Error("Invalid workspace template: template must be a JSON object")
  }
  const msg = prefix(template)

  if (!nonEmptyString(template.id)) {
    throw new Error(`${msg} 'id' must be a non-empty string`)
  }
  if (!nonEmptyString(template.name)) {
    throw new Error(`${msg} 'name' must be a non-empty string`)
  }
  if (!nonEmptyString(template.version)) {
    throw new Error(`${msg} 'version' must be a non-empty string`)
  }
  // Version format (e.g. semver) could be validated later; not required now.

  if (!Array.isArray(template.modules)) {
    throw new Error(`${msg} 'modules' must be an array`)
  }
  if (template.modules.length === 0) {
    throw new Error(`${msg} modules array must not be empty`)
  }

  const moduleIds = new Set<string>()
  for (let i = 0; i < template.modules.length; i++) {
    validateModule(template.modules[i], i, msg)
    const mod = template.modules[i] as Record<string, unknown>
    const id = mod.id as string
    if (moduleIds.has(id)) {
      throw new Error(`${msg} duplicate module id '${id}'`)
    }
    moduleIds.add(id)
  }

  // inputs may be omitted or an array (possibly empty).
  if (template.inputs !== undefined) {
    if (!Array.isArray(template.inputs)) {
      throw new Error(`${msg} 'inputs' must be an array when present`)
    }
    const inputKeys = new Set<string>()
    for (let i = 0; i < template.inputs.length; i++) {
      validateInput(template.inputs[i], i, msg)
      const key = (template.inputs[i] as Record<string, unknown>).key as string
      if (inputKeys.has(key)) {
        throw new Error(`${msg} duplicate input key '${key}'`)
      }
      inputKeys.add(key)
    }
  }
}
