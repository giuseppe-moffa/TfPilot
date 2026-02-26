import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

import { gh } from "@/lib/github/client"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { githubRequest } from "@/lib/github/rateAware"
import { getEnvTargetFile, getModuleType } from "@/lib/infra/moduleType"
import { resolveInfraRepo } from "@/config/infra-repos"
import { env } from "@/lib/config/env"
import { moduleRegistry, type ModuleRegistryEntry, type ModuleField } from "@/config/module-registry"
import { getRequest, saveRequest, updateRequest } from "@/lib/storage/requestsStore"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole } from "@/lib/auth/roles"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { putPrIndex } from "@/lib/requests/prIndex"
import { buildWorkflowDispatchPatch, persistWorkflowDispatchIndex } from "@/lib/requests/persistWorkflowDispatch"
import { getIdempotencyKey, assertIdempotentOrRecord, ConflictError } from "@/lib/requests/idempotency"
import { acquireLock, releaseLock, LockConflictError, type RequestDocWithLock } from "@/lib/requests/lock"
import { buildResourceName } from "@/lib/requests/naming"
import { normalizeName, validateResourceName } from "@/lib/validation/resourceName"
import { injectServerAuthoritativeTags, assertRequiredTagsPresent } from "@/lib/requests/tags"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { ensureAssistantState } from "@/lib/assistant/state"

const PLAN_WORKFLOW = env.GITHUB_PLAN_WORKFLOW_FILE
const RENDERER_VERSION = "tfpilot-renderer@1"

function toSnakeCase(key: string) {
  return key.replace(/([A-Z])/g, "_$1").replace(/-/g, "_").toLowerCase()
}

function normalizeConfigKeys(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const snake = toSnakeCase(k)
    out[snake] = v
  }
  return out
}

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

function buildModuleConfig(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) {
  if (!entry.fields || entry.fields.length === 0) {
    throw new Error(`Module ${entry.type} missing fields schema (schema contract v2 required)`)
  }
  const fields = buildFieldMap(entry)
  const allowed = new Set(Object.keys(fields))

  const initial: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawConfig ?? {})) {
    if (!allowed.has(k)) continue
    const field = fields[k]
    if (field.readOnly || field.immutable) continue
    initial[k] = coerceByType(field, v)
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

async function fetchRepoFile(token: string, owner: string, repo: string, filePath: string): Promise<string | null> {
  try {
    const res = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`)
    const json = (await res.json()) as { content?: string; encoding?: string }
    if (json.content && json.encoding === "base64") {
      return Buffer.from(json.content, "base64").toString("utf8")
    }
  } catch (err: any) {
    if (err?.status === 404) return null
    throw err
  }
  return null
}

function upsertRequestBlock(existing: string | null, requestId: string, blockBody: string) {
  const header = "# Managed by TfPilot - do not edit by hand."
  const begin = `# --- tfpilot:begin:${requestId} ---`
  const end = `# --- tfpilot:end:${requestId} ---`
  const body = `${begin}\n${blockBody.trimEnd()}\n${end}\n`

  let base = existing ?? ""
  if (!base.trim()) {
    base = `${header}\n\n`
  } else if (!base.endsWith("\n")) {
    base += "\n"
  }

  const startIdx = base.indexOf(begin)
  const endIdx = base.indexOf(end)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = base.slice(0, startIdx)
    const after = base.slice(endIdx + end.length)
    return `${before}${body}${after}`.replace(/\n{3,}/g, "\n\n")
  }

  return `${base}${body}`
}

function renderHclValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (Array.isArray(value) || typeof value === "object") {
    return `jsonencode(${JSON.stringify(value)})`
  }
  return `"${String(value)}"`
}

/** HCL map keys with ':' or other non-identifier chars must be quoted. */
function hclTagKey(key: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return key
  return `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function renderModuleBlock(request: any, moduleSource: string) {
  const renderedInputs = Object.entries(request.config).map(([key, val]) => {
    if (key === "tags" && val && typeof val === "object" && !Array.isArray(val)) {
      const tagEntries = Object.entries(val as Record<string, unknown>).map(([k, v]) => `    ${hclTagKey(k)} = ${renderHclValue(v)}`)
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

async function createBranchCommitPrAndPlan(
  token: string,
  request: any,
  files: Array<{ path: string; content: string }>,
  target: { owner: string; repo: string; base: string },
  branchName: string
) {
  const refRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/ref/heads/${target.base}`)
  const refJson = (await refRes.json()) as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) throw new Error("Failed to resolve base branch SHA")

  try {
    await gh(token, `/repos/${target.owner}/${target.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    })
  } catch (err: any) {
    if (err?.status !== 422) {
      throw err
    }
  }

  const baseCommitRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/commits/${baseSha}`)
  const baseCommit = (await baseCommitRes.json()) as { tree?: { sha?: string } }
  const baseTreeSha = baseCommit.tree?.sha
  if (!baseTreeSha) throw new Error("Failed to resolve base tree")

  const blobs: Array<{ path: string; sha: string }> = []
  for (const file of files) {
    const blobRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    })
    const blobJson = (await blobRes.json()) as { sha?: string }
    if (!blobJson.sha) throw new Error("Failed to create blob")
    blobs.push({ path: file.path, sha: blobJson.sha })
  }

  const treeRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  })
  const treeJson = (await treeRes.json()) as { sha?: string }
  if (!treeJson.sha) throw new Error("Failed to create tree")

  const commitRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `chore: update request ${request.id} (rev ${request.revision ?? "?"})`,
      tree: treeJson.sha,
      parents: [baseSha],
    }),
  })
  const commitJson = (await commitRes.json()) as { sha?: string }
  if (!commitJson.sha) throw new Error("Failed to create commit")

  await gh(token, `/repos/${target.owner}/${target.repo}/git/refs/heads/${branchName}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitJson.sha, force: true }),
  })

  const prRes = await gh(token, `/repos/${target.owner}/${target.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Update request ${request.id}: ${request.module} (rev ${request.revision ?? "?"})`,
      head: branchName,
      base: target.base,
      body: `Updated configuration for ${request.project}/${request.environment}\n\nModule: ${request.module}\nRequest ID: ${request.id}\nRevision: ${request.revision ?? "?"}`,
    }),
  })
  const prJson = (await prRes.json()) as { number?: number; html_url?: string; head?: { sha?: string } }
  if (!prJson.number || !prJson.html_url) throw new Error("Failed to open PR")

  await gh(token, `/repos/${target.owner}/${target.repo}/actions/workflows/${PLAN_WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: branchName,
      inputs: {
        request_id: request.id,
        environment: request.environment,
      },
    }),
  })

  let workflowRunId: number | undefined
  let workflowRunUrl: string | undefined
  const planHeadSha = prJson.head?.sha
  try {
    const runsJson = await githubRequest<{ workflow_runs?: Array<{ id: number }> }>({
      token,
      key: `gh:wf-runs:${target.owner}:${target.repo}:${PLAN_WORKFLOW}:${branchName}`,
      ttlMs: 15_000,
      path: `/repos/${target.owner}/${target.repo}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(branchName)}&per_page=1`,
      context: { route: "requests/update" },
    })
    workflowRunId = runsJson.workflow_runs?.[0]?.id
    if (workflowRunId) {
      workflowRunUrl = `https://github.com/${target.owner}/${target.repo}/actions/runs/${workflowRunId}`
    }
  } catch {
    /* ignore */
  }

  return {
    branchName,
    prNumber: prJson.number,
    prUrl: prJson.html_url,
    commitSha: commitJson.sha,
    planHeadSha,
    planRunId: workflowRunId,
    planRunUrl: workflowRunUrl,
    baseSha,
  }
}

async function closeSupersededPr(params: {
  token: string
  owner: string
  repo: string
  previousPrNumber: number
  newPrNumber: number
  nextRevision: number
}) {
  const { token, owner, repo, previousPrNumber, newPrNumber, nextRevision } = params
  try {
    const prJson = await githubRequest<{ state?: string; merged?: boolean }>({
      token,
      key: `gh:pr:${owner}:${repo}:${previousPrNumber}`,
      ttlMs: 30_000,
      path: `/repos/${owner}/${repo}/pulls/${previousPrNumber}`,
      context: { route: "requests/update" },
    })
    if (prJson.merged) return false
    if (prJson.state !== "open") return false

    await gh(token, `/repos/${owner}/${repo}/issues/${previousPrNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `Superseded by revision ${nextRevision} — see PR #${newPrNumber}`,
      }),
    })

    await gh(token, `/repos/${owner}/${repo}/pulls/${previousPrNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    })
    return true
  } catch {
    return false
  }
}

function isApplyRunning(request: any) {
  const status = deriveLifecycleStatus(request)
  const applyRun = request?.github?.workflows?.apply ?? request?.applyRun
  const applyRunStatus = applyRun?.status
  return status === "applying" || applyRunStatus === "in_progress" || applyRunStatus === "queued"
}

export async function POST(req: NextRequest) {
  const start = Date.now()
  const correlation = withCorrelation(req, {})
  const holder = correlation.correlationId
  let requestId: string | undefined
  try {
    const body = (await req.json()) as { requestId?: string; patch?: Record<string, unknown> }
    requestId = body.requestId
    if (!body.requestId || typeof body.requestId !== "string") {
      return NextResponse.json({ success: false, error: "requestId is required" }, { status: 400 })
    }
    if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
      return NextResponse.json({ success: false, error: "patch must be an object" }, { status: 400 })
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role === "viewer") {
      return NextResponse.json({ success: false, error: "Insufficient role" }, { status: 403 })
    }

    const token = await getGitHubAccessToken(req)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    const current = ensureAssistantState(await getRequest(body.requestId))
    if (!current) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }

    const idemKey = getIdempotencyKey(req) ?? ""
    const now = new Date()
    let idemPatch: { idempotency: Record<string, { key: string; at: string }> } | null = null
    try {
      const idem = assertIdempotentOrRecord({
        requestDoc: current as { idempotency?: Record<string, { key: string; at: string }> },
        operation: "update",
        key: idemKey,
        now,
      })
      if (idem.ok === false && idem.mode === "replay") {
        logInfo("idempotency.replay", { ...correlation, requestId: current.id, operation: "update" })
        return NextResponse.json({
          success: true,
          requestId: current.id,
          revision: typeof current.revision === "number" ? current.revision : 1,
          prUrl: (current as { prUrl?: string }).prUrl,
          planRunId: (current as { planRun?: { runId?: number } }).planRun?.runId,
        })
      }
      if (idem.ok === true && idem.mode === "recorded") {
        idemPatch = idem.patch
        await updateRequest(current.id, (c) => ({ ...c, ...idem.patch, updatedAt: now.toISOString() }))
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        logWarn("idempotency.conflict", { ...correlation, requestId: current.id, operation: err.operation })
        return NextResponse.json(
          { error: "Conflict", message: `Idempotency key mismatch for operation ${err.operation}` },
          { status: 409 }
        )
      }
      throw err
    }

    logInfo("request.update", { ...correlation, requestId: current.id, user: session.login })

    try {
      const lockResult = acquireLock({
        requestDoc: current as { lock?: { holder: string; operation: string; acquiredAt: string; expiresAt: string } },
        operation: "update",
        holder,
        now,
      })
      if (lockResult.patch) {
        await updateRequest(current.id, (c) => ({ ...c, ...lockResult.patch, updatedAt: now.toISOString() }))
      }
    } catch (lockErr) {
      if (lockErr instanceof LockConflictError) {
        logWarn("lock.conflict", { ...correlation, requestId: current.id, operation: lockErr.operation })
        return NextResponse.json(
          { error: "Locked", message: "Request is currently locked by another operation" },
          { status: 409 }
        )
      }
      throw lockErr
    }

    if (isApplyRunning(current)) {
      return NextResponse.json({ success: false, error: "Cannot update while apply in progress" }, { status: 409 })
    }

    const regEntry = moduleRegistry.find((m) => m.type === current.module)
    if (!regEntry) {
      return NextResponse.json({ success: false, error: "Unknown module for request" }, { status: 400 })
    }

    const normalizedPatch = normalizeConfigKeys(body.patch)
    const mergedInputs = { ...(current.config ?? {}), ...normalizedPatch }
    if (typeof mergedInputs.name === "string") {
      mergedInputs.name = normalizeName(mergedInputs.name)
    }

    const revisionPrev = typeof current.revision === "number" && current.revision >= 1 ? current.revision : 1
    const revisionNext = revisionPrev + 1

    const moduleType = getModuleType(current.module, regEntry.category)
    const targetOwner = current.targetOwner ?? resolveInfraRepo(current.project, current.environment)?.owner
    const targetRepo = current.targetRepo ?? resolveInfraRepo(current.project, current.environment)?.repo
    const targetBase = current.targetBase ?? resolveInfraRepo(current.project, current.environment)?.base
    const targetEnvPath = current.targetEnvPath ?? resolveInfraRepo(current.project, current.environment)?.envPath

    if (!targetOwner || !targetRepo || !targetBase || !targetEnvPath) {
      return NextResponse.json({ success: false, error: "Missing target repo metadata on request" }, { status: 400 })
    }

    const finalConfig = buildModuleConfig(regEntry, mergedInputs, {
      requestId: current.id,
      project: current.project,
      environment: current.environment,
    })

    appendRequestIdToNames(finalConfig, current.id)

    const nameVal = typeof finalConfig.name === "string" ? finalConfig.name : ""
    if (nameVal) {
      const nameResult = validateResourceName(nameVal)
      if (!nameResult.ok) {
        return NextResponse.json({ fieldErrors: { name: nameResult.error } }, { status: 400 })
      }
    }
    // Server-authoritative tags: re-inject so required keys always present in stored/rendered config.
    injectServerAuthoritativeTags(finalConfig, current, session.login)
    assertRequiredTagsPresent(finalConfig, current)

    validatePolicy(finalConfig)

    const moduleSource = `../../modules/${current.module}`
    const targetFile = getEnvTargetFile(targetEnvPath, moduleType)

    const existingFile = await fetchRepoFile(token, targetOwner, targetRepo, targetFile)
    const beginMarker = `# --- tfpilot:begin:${current.id} ---`
    const endMarker = `# --- tfpilot:end:${current.id} ---`
    if (!existingFile || !existingFile.includes(beginMarker) || !existingFile.includes(endMarker)) {
      return NextResponse.json({ success: false, error: "Existing request block not found in target file" }, { status: 400 })
    }

    const block = renderModuleBlock({ ...current, config: finalConfig }, moduleSource)
    const updatedFile = upsertRequestBlock(existingFile, current.id, block)

    const branchName = `update/${current.id}/rev-${revisionNext}`
    const ghResult = await createBranchCommitPrAndPlan(
      token,
      { ...current, revision: revisionNext, environment: current.environment },
      [{ path: targetFile, content: updatedFile }],
      { owner: targetOwner, repo: targetRepo, base: targetBase },
      branchName
    )

    const previousPrNumber = current.activePrNumber ?? current.pr?.number
    const previousPrs = Array.isArray(current.previousPrs) ? [...current.previousPrs] : []
    let superseded = false
    if (previousPrNumber && previousPrNumber !== ghResult.prNumber) {
      superseded = await closeSupersededPr({
        token,
        owner: targetOwner,
        repo: targetRepo,
        previousPrNumber,
        newPrNumber: ghResult.prNumber,
        nextRevision: revisionNext,
      })
      if (superseded && !previousPrs.includes(previousPrNumber)) {
        previousPrs.push(previousPrNumber)
      }
    }

    const registryCommitSha =
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.TFPILOT_APP_COMMIT || "unknown"
    const renderPayload = {
      moduleCommit: ghResult.baseSha ?? current.moduleRef?.commitSha ?? "unknown",
      registryCommit: registryCommitSha,
      normalizedInputs: finalConfig,
      rendererVersion: RENDERER_VERSION,
    }

    const updatedRequest = {
      ...current,
      ...(idemPatch ?? {}),
      config: finalConfig,
      revision: revisionNext,
      updatedAt: new Date().toISOString(),
      branchName: ghResult.branchName,
      prNumber: ghResult.prNumber,
      prUrl: ghResult.prUrl,
      commitSha: ghResult.commitSha,
      activePrNumber: ghResult.prNumber,
      previousPrs,
      pr: {
        number: ghResult.prNumber,
        url: ghResult.prUrl,
        merged: false,
        headSha: ghResult.planHeadSha,
        open: true,
      },
      targetOwner,
      targetRepo,
      targetBase,
      targetEnvPath,
      targetFiles: [targetFile],
      planRun: {
        runId: ghResult.planRunId,
        url: ghResult.planRunUrl,
        headSha: ghResult.planHeadSha,
      },
      ...(ghResult.planRunId != null
        ? buildWorkflowDispatchPatch(current as Record<string, unknown>, "plan", ghResult.planRunId, ghResult.planRunUrl)
        : {}),
      moduleRef: current.moduleRef ?? {
        repo: `${targetOwner}/${targetRepo}`,
        path: `modules/${current.module}`,
        commitSha: ghResult.baseSha ?? "unknown",
        resolvedAt: new Date().toISOString(),
      },
      registryRef: {
        commitSha: registryCommitSha,
        resolvedAt: new Date().toISOString(),
      },
      rendererVersion: RENDERER_VERSION,
      render: {
        renderHash: `sha256:${sha256(stableStringify(renderPayload))}`,
        inputsHash: `sha256:${sha256(stableStringify(finalConfig))}`,
        reproducible: true,
        computedAt: new Date().toISOString(),
      },
    }

    const currentVersion = typeof current.version === "number" ? current.version : 0
    await saveRequest(
      { ...updatedRequest, version: currentVersion + 1 },
      { expectedVersion: currentVersion }
    )

    await putPrIndex(targetOwner, targetRepo, ghResult.prNumber, current.id).catch(() => {})
    if (ghResult.planRunId != null) {
      persistWorkflowDispatchIndex(current.id, "plan", ghResult.planRunId)
    }

    const afterSave = await getRequest(current.id)
    if (afterSave) {
      const releasePatch = releaseLock(afterSave as RequestDocWithLock, holder)
      if (releasePatch) await updateRequest(current.id, (c) => ({ ...c, ...releasePatch }))
    }

    await logLifecycleEvent({
      requestId: current.id,
      event: "configuration_updated",
      actor: session.login,
      source: "api/requests/update",
      data: {
        fromRevision: revisionPrev,
        toRevision: revisionNext,
        prNumber: ghResult.prNumber,
        planRunId: ghResult.planRunId,
        supersededPr: superseded ? previousPrNumber : undefined,
      },
    })

    return NextResponse.json({
      success: true,
      requestId: current.id,
      revision: revisionNext,
      prUrl: ghResult.prUrl,
      planRunId: ghResult.planRunId,
    })
  } catch (error) {
    logError("request.update_failed", error, { ...correlation, duration_ms: Date.now() - start })
    try {
      if (requestId && holder) {
        const currentDoc = await getRequest(requestId).catch(() => null)
        if (currentDoc) {
          const releasePatch = releaseLock(currentDoc as RequestDocWithLock, holder)
          if (releasePatch) await updateRequest(requestId, (c) => ({ ...c, ...releasePatch }))
        }
      }
    } catch {
      /* best-effort release */
    }
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
