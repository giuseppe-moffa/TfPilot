import { NextRequest, NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { moduleRegistry, type ModuleField, type ModuleRegistryEntry } from "@/config/module-registry"
import { ensureAssistantState, isAllowedPatchPath } from "@/lib/assistant/state"
import { getRequest, updateRequest } from "@/lib/storage/requestsStore"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { buildResourceName } from "@/lib/requests/naming"
import { env } from "@/lib/config/env"
import { normalizeName, validateResourceName } from "@/lib/validation/resourceName"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { gh } from "@/lib/github/client"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logWarn } from "@/lib/observability/logger"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"
import { getCurrentAttemptStrict, persistDispatchAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { putRunIndex } from "@/lib/requests/runIndex"
import { resolveApplyRunId } from "@/lib/requests/resolveApplyRunId"

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

export async function POST(req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await context.params
    if (!requestId) {
      return NextResponse.json({ success: false, error: "Missing requestId" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    let body: { suggestionIds?: string[] }
    try {
      body = (await req.json().catch(() => ({}))) as { suggestionIds?: string[] }
    } catch {
      body = {}
    }
    const suggestionIds = Array.isArray(body?.suggestionIds) ? body.suggestionIds : []

    if (suggestionIds.length === 0) {
      const correlation = withCorrelation(req, {})
      const holder = correlation.correlationId
      try {
        const token = await getGitHubAccessToken(req)
        if (!token) {
          return NextResponse.json({ error: "GitHub not connected" }, { status: 401 })
        }
        const role = getUserRole(session.login)
        if (role !== "approver" && role !== "admin") {
          return NextResponse.json({ error: "Apply not permitted for your role" }, { status: 403 })
        }
        const request = await getRequest(requestId).catch(() => null)
        if (!request) {
          return NextResponse.json({ error: "Request not found" }, { status: 404 })
        }
        const now = new Date()
        const idemKey = getIdempotencyKey(req) ?? ""
        try {
          const idem = assertIdempotentOrRecord({
            requestDoc: request as { idempotency?: Record<string, { key: string; at: string }> },
            operation: "apply",
            key: idemKey,
            now,
          })
          if (idem.ok === false && idem.mode === "replay") {
            const current = await getRequest(request.id).catch(() => null)
            return NextResponse.json({ ok: true, request: current ?? request })
          }
          if (idem.ok === true && idem.mode === "recorded" && idem.patch) {
            await updateRequest(request.id, (c) => ({ ...c, ...idem.patch, updatedAt: now.toISOString() }))
          }
        } catch (err) {
          if (err instanceof ConflictError) {
            return NextResponse.json(
              { error: "Conflict", message: `Idempotency key mismatch for operation apply` },
              { status: 409 }
            )
          }
          throw err
        }
        try {
          const lockResult = acquireLock({
            requestDoc: request as { lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string } },
            operation: "apply",
            holder,
            now,
          })
          if (lockResult.patch) {
            await updateRequest(request.id, (c) => ({ ...c, ...lockResult.patch, updatedAt: now.toISOString() }))
          }
        } catch (lockErr) {
          if (lockErr instanceof LockConflictError) {
            return NextResponse.json(
              { error: "Locked", message: "Request is currently locked by another operation" },
              { status: 409 }
            )
          }
          throw lockErr
        }
        const status = deriveLifecycleStatus(request)
        const applyAttempt = getCurrentAttemptStrict(request?.runs as RunsState | undefined, "apply")
        const applyErrorState =
          applyAttempt?.conclusion === "failure" || applyAttempt?.conclusion === "cancelled"
        const applyStillRunning =
          applyAttempt?.status === "in_progress" || applyAttempt?.status === "queued"
        const canDeploy =
          status === "merged" ||
          (status === "failed" && applyErrorState && !applyStillRunning)
        if (!canDeploy) {
          return NextResponse.json({ error: "Request must be merged before apply" }, { status: 400 })
        }
        const isProd = request.environment?.toLowerCase() === "prod"
        if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
          if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
            return NextResponse.json({ error: "Prod apply not allowed for this user" }, { status: 403 })
          }
        }
        const owner = request.targetOwner
        const repo = request.targetRepo
        const applyRef = request.branchName ?? request.targetBase ?? "main"
        if (!owner || !repo) {
          return NextResponse.json({ error: "Request missing target repo info" }, { status: 400 })
        }
        const dispatchTime = new Date()
        await gh(token, `/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_APPLY_WORKFLOW_FILE}/dispatches`, {
          method: "POST",
          body: JSON.stringify({
            ref: applyRef,
            inputs: { request_id: request.id, environment: request.environment ?? "dev" },
          }),
        })
        const RESOLVE_ATTEMPTS = 12
        const BACKOFF_MS = [500, 500, 1000, 1000, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
        let runIdApply: number | undefined
        let urlApply: string | undefined
        for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]))
          }
          try {
            const result = await resolveApplyRunId({
              token,
              owner,
              repo,
              workflowFile: env.GITHUB_APPLY_WORKFLOW_FILE,
              branch: applyRef,
              requestId: request.id,
              dispatchTime,
              logContext: { route: "requests/[requestId]/apply", correlationId: correlation.correlationId ?? request.id },
            })
            if (result) {
              runIdApply = result.runId
              urlApply = result.url
              break
            }
          } catch (err) {
            if (attempt === RESOLVE_ATTEMPTS - 1) {
              logWarn("apply.resolve_run_failed", {
                ...correlation,
                requestId: request.id,
                attempt: attempt + 1,
                err: String(err),
              })
            }
          }
        }
        if (runIdApply != null) {
          try {
            await putRunIndex("apply", runIdApply, request.id)
          } catch (err) {
            logWarn("apply.run_index_write_failed", {
              ...correlation,
              requestId: request.id,
              runId: runIdApply,
              err: String(err),
            })
          }
        }
        const nowIso = new Date().toISOString()
        const [afterApply] = await updateRequest(request.id, (current) => {
          const runId = runIdApply ?? undefined
          const runUrl = urlApply ?? undefined
          const runsPatch =
            runId != null && runUrl != null
              ? persistDispatchAttempt(current as Record<string, unknown>, "apply", {
                  runId,
                  url: runUrl,
                  actor: session.login,
                })
              : {}
          return {
            ...current,
            ...runsPatch,
            updatedAt: (runsPatch as { updatedAt?: string })?.updatedAt ?? nowIso,
          }
        })
        const releasePatch = releaseLock(afterApply as RequestDocWithLock, holder)
        if (releasePatch) {
          await updateRequest(request.id, (c) => ({ ...c, ...releasePatch }))
        }
        await logLifecycleEvent({
          requestId: request.id,
          event: "apply_dispatched",
          actor: session.login,
          source: "api/requests/[requestId]/apply",
          data: {
            runId: runIdApply,
            url: urlApply,
            targetRepo: `${owner}/${repo}`,
          },
        })
        return NextResponse.json({ ok: true, request: afterApply })
      } catch (deployErr) {
        logError("apply.dispatch_failed", deployErr as Error, { requestId })
        try {
          const current = await getRequest(requestId).catch(() => null)
          if (current) {
            const releasePatch = releaseLock(current as RequestDocWithLock, withCorrelation(req, {}).correlationId)
            if (releasePatch) await updateRequest(requestId, (c) => ({ ...c, ...releasePatch }))
          }
        } catch {
          /* best-effort */
        }
        return NextResponse.json({ error: "Failed to dispatch apply" }, { status: 500 })
      }
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

    const regEntry = moduleRegistry.find((m) => m.type === baseRequest.module)
    if (!regEntry) {
      return NextResponse.json({ success: false, error: "Unknown module for request" }, { status: 400 })
    }

    const fieldsMap = buildFieldMap(regEntry)

    const selected = baseRequest.assistant_state.suggestions.filter((s: any) =>
      suggestionIds.includes(s.id)
    )
    if (selected.length === 0) {
      return NextResponse.json({ success: false, error: "No matching suggestions found" }, { status: 400 })
    }

    const patchOps: PatchOp[] = selected.flatMap((s: any) => s.patch ?? [])
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
        source: "suggestion" as const,
        patch: patchOps,
      }
      const appliedIds = new Set<string>(withAssistant.assistant_state.applied_suggestion_ids ?? [])
      for (const id of suggestionIds) appliedIds.add(id)

      return {
        ...withAssistant,
        config: finalConfig,
        assistant_state: {
          ...withAssistant.assistant_state,
          applied_suggestion_ids: Array.from(appliedIds),
          applied_patch_log: [...withAssistant.assistant_state.applied_patch_log, appliedLog],
        },
      updatedAt: new Date().toISOString(),
      }
    })

    return NextResponse.json({ success: true, request: updated }, { status: 200 })
  } catch (error) {
    console.error("[api/requests/apply] error", error)
    return NextResponse.json({ success: false, error: "Failed to apply to configuration" }, { status: 400 })
}
}
