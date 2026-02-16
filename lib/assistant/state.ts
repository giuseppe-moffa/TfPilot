import crypto from "crypto"
import { z } from "zod"

const PATCH_PATH_REGEX = /^\/(inputs|advanced)\//

export type PatchOp = {
  op: "set" | "unset"
  path: string
  value?: unknown
}

export type AssistantSuggestion = {
  id: string
  severity: "low" | "medium" | "high"
  title: string
  description?: string
  patch: PatchOp[]
}

export type ClarificationOption = { key: string; label: string }

export type AssistantClarification = {
  id: string
  question: string
  type: "choice" | "text" | "boolean"
  required: boolean
  options?: ClarificationOption[]
  placeholder?: string
  patchesByOption?: Record<string, PatchOp[]>
  patchesFromText?: { path: string; op: "set" }
  constraints?: { regex?: string; min?: number; max?: number }
}

export type AssistantState = {
  last_suggestions_hash: string | null
  suggestions: AssistantSuggestion[]
  clarifications: AssistantClarification[]
  clarifications_resolved: Record<string, { answer: unknown; ts: string }>
  applied_suggestion_ids: string[]
  applied_patch_log: Array<{ ts: string; source: "suggestion" | "clarification"; patch: PatchOp[] }>
}

const patchOpSchema = z.object({
  op: z.union([z.literal("set"), z.literal("unset")]),
  path: z.string().regex(PATCH_PATH_REGEX, "Patch path must start with /inputs/ or /advanced/"),
  value: z.any().optional(),
})

const suggestionSchema: z.ZodType<AssistantSuggestion> = z.object({
  id: z.string(),
  severity: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]),
  title: z.string(),
  description: z.string().optional(),
  patch: z.array(patchOpSchema),
})

const clarificationSchema: z.ZodType<AssistantClarification> = z.object({
  id: z.string(),
  question: z.string(),
  type: z.union([z.literal("choice"), z.literal("text"), z.literal("boolean")]),
  required: z.boolean(),
  options: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
  patchesByOption: z.record(z.array(patchOpSchema)).optional(),
  patchesFromText: z
    .object({
      path: z.string().regex(PATCH_PATH_REGEX),
      op: z.literal("set"),
    })
    .optional(),
  constraints: z
    .object({
      regex: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
})

function sortValue(val: any): any {
  if (Array.isArray(val)) return val.map((v) => sortValue(v))
  if (val && typeof val === "object") {
    const sorted: Record<string, any> = {}
    for (const [k, v] of Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) {
      sorted[k] = sortValue(v)
    }
    return sorted
  }
  return val
}

function stableStringify(val: any) {
  return JSON.stringify(sortValue(val))
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export function validatePatchOps(patch: PatchOp[]) {
  return z.array(patchOpSchema).parse(patch)
}

export function validateSuggestions(suggestions: AssistantSuggestion[]) {
  return z.array(suggestionSchema).parse(suggestions)
}

export function validateClarifications(clarifications: AssistantClarification[]) {
  return z.array(clarificationSchema).parse(clarifications)
}

export function computeSuggestionId(patch: PatchOp[]) {
  const normalized = validatePatchOps(patch)
  return sha256(stableStringify({ patch: normalized }))
}

type SuggestionsHashInput = {
  moduleKey?: string
  normalizedInputs?: Record<string, unknown>
  registryVersion?: string | null
  suggestions: Array<{ patch: PatchOp[] }>
  clarifications: Array<{
    id: string
    options?: ClarificationOption[]
    patchesByOption?: Record<string, PatchOp[]>
    patchesFromText?: { path: string; op: "set" }
  }>
}

export function computeSuggestionsHash(input: SuggestionsHashInput) {
  const payload = {
    moduleKey: input.moduleKey ?? null,
    normalizedInputs: sortValue(input.normalizedInputs ?? {}),
    registryVersion: input.registryVersion ?? null,
    suggestions: input.suggestions.map((s) => ({ patch: validatePatchOps(s.patch) })),
    clarifications: input.clarifications.map((c) => ({
      id: c.id,
      options: c.options ?? [],
      patchesByOption: c.patchesByOption ?? {},
      patchesFromText: c.patchesFromText ?? null,
    })),
  }
  return sha256(stableStringify(payload))
}

export function ensureAssistantState<T extends Record<string, any>>(request: T): T & { assistant_state: AssistantState } {
  const existing = (request as any).assistant_state ?? {}
  const assistant_state: AssistantState = {
    last_suggestions_hash: existing.last_suggestions_hash ?? null,
    suggestions: Array.isArray(existing.suggestions) ? existing.suggestions : [],
    clarifications: Array.isArray(existing.clarifications) ? existing.clarifications : [],
    clarifications_resolved: existing.clarifications_resolved ?? {},
    applied_suggestion_ids: Array.isArray(existing.applied_suggestion_ids) ? existing.applied_suggestion_ids : [],
    applied_patch_log: Array.isArray(existing.applied_patch_log) ? existing.applied_patch_log : [],
  }
  return { ...request, assistant_state }
}

export function isAllowedPatchPath(path: string) {
  return PATCH_PATH_REGEX.test(path)
}
