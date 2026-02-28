import { NextRequest, NextResponse } from "next/server"

import { moduleRegistry, type ModuleField, type ModuleRegistryEntry } from "@/config/module-registry"
import { ensureAssistantState, isAllowedPatchPath } from "@/lib/assistant/state"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { getCurrentAttemptStrict } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { buildResourceName } from "@/lib/requests/naming"
import { env } from "@/lib/config/env"
import { normalizeName, validateResourceName } from "@/lib/validation/resourceName"

type PatchOp = { op: "set" | "unset"; path: string; value?: unknown }

function toSnakeCase(key: string) {
  return key.replace(/([A-Z])/g, "_$1").replace(/-/g, "_").toLowerCase()
}

function coerceByType(field: ModuleField | undefined, value: unknown): unknown {
  if (!field) return value
  switch (field.type) {
    case "string":
      return value === undefined || value === null ? undefined : String(value)
    case "number": {
      if (typeof value === "number") return value
      if (value === undefined || value === null) return undefined
      const n = Number(value)
      return Number.isNaN(n) ? undefined : n
    }
    case "boolean":
      if (typeof value === "boolean") return value
      if (value === undefined || value === null) return undefined
      if (typeof value === "string") {
        const v = value.trim().toLowerCase()
        if (["true", "1", "yes", "on"].includes(v)) return true
        if (["false", "0", "no", "off"].includes(v)) return false
      }
      return Boolean(value)
    case "map":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (v === undefined || v === null) continue
          out[k] = String(v)
        }
        return out
      }
      return undefined
    case "list":
      if (Array.isArray(value)) return value
      if (value === undefined || value === null) return undefined
      if (typeof value === "string") {
        const text = value.trim()
        if (!text) return undefined
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed)) return parsed
        } catch {
          /* ignore */
        }
        return text.split(",").map((v) => v.trim()).filter(Boolean)
      }
      return undefined
    case "enum":
      if (value === undefined || value === null) return undefined
      return String(value)
    default:
      return value
  }
}

function buildFieldMap(entry: ModuleRegistryEntry): Record<string, ModuleField> {
  const map: Record<string, ModuleField> = {}
  for (const f of entry.fields ?? []) {
    map[f.name] = f
  }
  return map
}

function applyDefaults(fields: Record<string, ModuleField>, cfg: Record<string, unknown>) {
  for (const f of Object.values(fields)) {
    if (cfg[f.name] === undefined && f.default !== undefined) {
      cfg[f.name] = f.default
    }
  }
}

function validateRequired(fields: Record<string, ModuleField>, cfg: Record<string, unknown>) {
  const missing = Object.values(fields)
    .filter((f) => f.required)
    .map((f) => f.name)
    .filter((k) => cfg[k] === undefined || cfg[k] === null || cfg[k] === "")
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`)
  }
}

function validateEnum(fields: Record<string, ModuleField>, cfg: Record<string, unknown>) {
  for (const f of Object.values(fields)) {
    if (f.type === "enum" && f.enum && cfg[f.name] !== undefined) {
      const val = cfg[f.name]
      if (!f.enum.includes(String(val))) {
        throw new Error(`Invalid value for ${f.name}; expected one of ${f.enum.join(", ")}`)
      }
    }
  }
}

function appendRequestIdToNames(config: Record<string, unknown>, requestId: string) {
  const fields = ["name"]
  for (const field of fields) {
    const current = config[field]
    if (typeof current !== "string") continue
    const trimmed = current.trim()
    if (!trimmed) continue
    if (trimmed.includes(requestId)) continue

    config[field] = buildResourceName(trimmed, requestId)
  }
}

function validatePolicy(config: Record<string, unknown>) {
  if (env.TFPILOT_ALLOWED_REGIONS.length > 0) {
    const regionCandidate =
      (typeof config.aws_region === "string" && config.aws_region) ||
      (typeof config.region === "string" && config.region) ||
      ""
    if (regionCandidate && !env.TFPILOT_ALLOWED_REGIONS.includes(regionCandidate)) {
      throw new Error(`Region ${regionCandidate} is not allowed`)
    }
  }
}

function normalizeByFields(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) {
  const fields = buildFieldMap(entry)
  const allowed = new Set(Object.keys(fields))

  const initial: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawConfig ?? {})) {
    const snake = toSnakeCase(k)
    if (!allowed.has(snake)) continue
    const field = fields[snake]
    if (field.readOnly || field.immutable) continue
    initial[snake] = coerceByType(field, v)
  }

  applyDefaults(fields, initial)
  validateEnum(fields, initial)

  const computed = entry.compute ? entry.compute(initial, ctx) : {}
  const merged = { ...initial, ...computed }

  const finalConfig: Record<string, unknown> = {}
  for (const k of Object.keys(fields)) {
    if (merged[k] !== undefined) {
      finalConfig[k] = merged[k]
    }
  }

  if (!finalConfig.name && fields.name?.required) {
    const value = (finalConfig.name ?? rawConfig.name) as string | undefined
    if (value && typeof value === "string" && value.trim()) {
      finalConfig.name = value.trim()
    }
  }

  validateRequired(fields, finalConfig)
  validateEnum(fields, finalConfig)

  return finalConfig
}

function buildModuleConfig(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) {
  if (!entry.fields || entry.fields.length === 0) {
    throw new Error(`Module ${entry.type} missing fields schema (schema contract v2 required)`)
  }
  const cfg: Record<string, unknown> = { ...(rawConfig ?? {}) }
  return normalizeByFields(entry, cfg, ctx)
}

function isLocked(request: any) {
  if (request?.locked_reason) return true
  const status = deriveLifecycleStatus(request)
  const applyAttempt = getCurrentAttemptStrict(request?.runs as RunsState | undefined, "apply")
  const applyStatus = applyAttempt?.status
  return status === "applying" || status === "planning" || applyStatus === "in_progress" || applyStatus === "queued"
}

function applyPatchToConfig(target: Record<string, unknown>, op: PatchOp) {
  if (!isAllowedPatchPath(op.path)) {
    throw new Error("Invalid patch path")
  }
  const rawPath = op.path.replace(/^\/(inputs|advanced)\//, "")
  const parts = rawPath.split("/").filter(Boolean)
  if (parts.length === 0) {
    throw new Error("Patch path missing key")
  }
  const key = parts[0]

  if (op.op === "unset") {
    if (parts.length === 1) {
      delete target[key]
      return
    }
    let cursor: any = target
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (typeof cursor[p] !== "object" || cursor[p] === null) return
      cursor = cursor[p]
    }
    delete cursor[parts[parts.length - 1]]
    return
  }

  let cursor: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (typeof cursor[p] !== "object" || cursor[p] === null) {
      cursor[p] = {}
    }
    cursor = cursor[p]
  }
  cursor[parts[parts.length - 1]] = op.value
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params
    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    const body = (await req.json()) as { clarificationId?: string; answer?: unknown }
    if (!body.clarificationId) {
      return NextResponse.json({ success: false, error: "clarificationId is required" }, { status: 400 })
    }

    const fetched = await getRequest(requestId).catch(() => null)
    if (!fetched) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }
    const baseRequest = ensureAssistantState(fetched)

    if (isLocked(baseRequest)) {
      const msg = baseRequest.locked_reason || "Request is locked (plan/apply running)"
      return NextResponse.json({ success: false, error: msg }, { status: 409 })
    }

    const clarification = baseRequest.assistant_state.clarifications.find((c: any) => c.id === body.clarificationId)
    if (!clarification) {
      return NextResponse.json({ success: false, error: "Clarification not found" }, { status: 404 })
    }

    const regEntry = moduleRegistry.find((m) => m.type === baseRequest.module)
    if (!regEntry) {
      return NextResponse.json({ success: false, error: "Unknown module for request" }, { status: 400 })
    }

    const fieldsMap = buildFieldMap(regEntry)
    const patchOps: PatchOp[] = []

    if (clarification.type === "text") {
      const textVal = typeof body.answer === "string" ? body.answer : String(body.answer ?? "")
      if (clarification.constraints?.regex) {
        const re = new RegExp(clarification.constraints.regex)
        if (!re.test(textVal)) {
          return NextResponse.json({ success: false, error: "Answer does not satisfy regex constraint" }, { status: 400 })
        }
      }
      if (clarification.constraints?.min !== undefined && textVal.length < clarification.constraints.min) {
        return NextResponse.json({ success: false, error: "Answer shorter than minimum" }, { status: 400 })
      }
      if (clarification.constraints?.max !== undefined && textVal.length > clarification.constraints.max) {
        return NextResponse.json({ success: false, error: "Answer longer than maximum" }, { status: 400 })
      }
      if (!clarification.patchesFromText) {
        return NextResponse.json({ success: false, error: "No patch mapping for text clarification" }, { status: 400 })
      }
      patchOps.push({ op: "set", path: clarification.patchesFromText.path, value: textVal })
    } else if (clarification.type === "choice" || clarification.type === "boolean") {
      const normalizedKey = typeof body.answer === "string" ? body.answer : body.answer === true ? "true" : body.answer === false ? "false" : String(body.answer ?? "")
      const options = clarification.options ?? []
      const match = options.find((o: any) => o.key === normalizedKey)
      if (!match && options.length > 0) {
        return NextResponse.json({ success: false, error: "Invalid choice" }, { status: 400 })
      }
      const key = match?.key ?? normalizedKey
      const optionPatches = clarification.patchesByOption?.[key]
      if (!optionPatches || optionPatches.length === 0) {
        return NextResponse.json({ success: false, error: "No patches for selected option" }, { status: 400 })
      }
      patchOps.push(...optionPatches)
    }

    for (const op of patchOps) {
      if (!isAllowedPatchPath(op.path)) {
        return NextResponse.json({ success: false, error: "Patch path not allowed" }, { status: 400 })
      }
      const key = op.path.replace(/^\/(inputs|advanced)\//, "").split("/")[0]
      const field = fieldsMap[key]
      if (op.op === "unset" && field?.required) {
        return NextResponse.json({ success: false, error: `Cannot unset required field: ${key}` }, { status: 400 })
      }
    }

    const nextConfig: Record<string, unknown> = { ...(baseRequest.config ?? {}) }
    for (const op of patchOps) {
      applyPatchToConfig(nextConfig, op)
    }
    if (typeof nextConfig.name === "string") {
      nextConfig.name = normalizeName(nextConfig.name)
    }

    const finalConfig = buildModuleConfig(regEntry, nextConfig, {
      requestId: baseRequest.id,
      project: baseRequest.project,
      environment: baseRequest.environment,
    })

    appendRequestIdToNames(finalConfig, baseRequest.id)
    const nameVal = typeof finalConfig.name === "string" ? finalConfig.name : ""
    if (nameVal) {
      const nameResult = validateResourceName(nameVal)
      if (!nameResult.ok) {
        return NextResponse.json({ fieldErrors: { name: nameResult.error } }, { status: 400 })
      }
    }
    validatePolicy(finalConfig)

    const [updated] = await updateRequest(requestId, (current) => {
      const withAssistant = ensureAssistantState(current)
      const appliedLog = {
        ts: new Date().toISOString(),
        source: "clarification" as const,
        patch: patchOps,
      }
      return {
        ...withAssistant,
        config: finalConfig,
        assistant_state: {
          ...withAssistant.assistant_state,
          clarifications_resolved: {
            ...(withAssistant.assistant_state.clarifications_resolved ?? {}),
            [clarification.id]: { answer: body.answer, ts: new Date().toISOString() },
          },
          applied_patch_log: [...withAssistant.assistant_state.applied_patch_log, appliedLog],
        },
        updatedAt: new Date().toISOString(),
      }
    })

    return NextResponse.json({ success: true, request: updated }, { status: 200 })
  } catch (error) {
    console.error("[clarifications/respond] error", error)
    return NextResponse.json({ success: false, error: "Failed to apply clarification" }, { status: 400 })
  }
}
