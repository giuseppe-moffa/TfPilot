import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

import { gh } from "@/lib/github/client"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { getEnvTargetFile, getModuleType } from "@/lib/infra/moduleType"
import { resolveInfraRepo } from "@/config/infra-repos"
import { env, logEnvDebug } from "@/lib/config/env"
import { saveRequest, listRequests } from "@/lib/storage/requestsStore"
import { moduleRegistry, type ModuleRegistryEntry, type ModuleField } from "@/config/module-registry"
import { generateRequestId } from "@/lib/requests/id"
import { buildResourceName, validateResourceName } from "@/lib/requests/naming"
import { getSessionFromCookies } from "@/lib/auth/session"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { getUserRole } from "@/lib/auth/roles"
import { ensureAssistantState } from "@/lib/assistant/state"

type RequestPayload = {
  project?: string
  environment?: string
  module?: string
  config?: Record<string, unknown>
}

type StoredRequest = {
  id: string
  project: string
  environment: string
  module: string
  config: Record<string, unknown>
  receivedAt: string
  updatedAt: string
  status: string
  revision?: number
  reason?: string
  statusDerivedAt?: string
  plan?: { diff: string }
  planRun?: { runId?: number; url?: string; status?: string; conclusion?: string; headSha?: string }
  applyRun?: { runId?: number; url?: string; status?: string; conclusion?: string }
  approval?: { approved?: boolean; approvers?: string[] }
  pr?: { number?: number; url?: string; merged?: boolean; headSha?: string; open?: boolean }
  activePrNumber?: number
  previousPrs?: number[]
  targetOwner?: string
  targetRepo?: string
  targetBase?: string
  targetEnvPath?: string
  targetFiles?: string[]
  errorMessage?: string
  branchName?: string
  prNumber?: number
  prUrl?: string
  commitSha?: string
  mergedSha?: string
  moduleRef?: { repo: string; path: string; commitSha: string; resolvedAt: string }
  registryRef?: { commitSha: string; resolvedAt: string }
  rendererVersion?: string
  render?: { renderHash: string; inputsHash?: string; reproducible?: boolean; computedAt: string }
}

const PLAN_WORKFLOW = env.GITHUB_PLAN_WORKFLOW_FILE
const RENDERER_VERSION = "tfpilot-renderer@1"
logEnvDebug()

function validatePayload(body: RequestPayload) {
  const errors: string[] = []

  if (!body.project || typeof body.project !== "string") {
    errors.push("project is required and must be a string")
  }
  if (!body.environment || typeof body.environment !== "string") {
    errors.push("environment is required and must be a string")
  }
  if (!body.module || typeof body.module !== "string") {
    errors.push("module is required and must be a string")
  }
  if (
    body.config === undefined ||
    body.config === null ||
    typeof body.config !== "object" ||
    Array.isArray(body.config)
  ) {
    errors.push("config is required and must be an object")
  }

  return errors
}

function planDiffForModule(mod?: string) {
  switch (mod) {
    case "ecs-service":
      return "+ aws_ecs_service.app"
    case "sqs-queue":
      return "+ aws_sqs_queue.main"
    case "s3-bucket":
      return "+ aws_s3_bucket.main"
    case "iam-role-app":
      return "+ aws_iam_role.app"
    default:
      return "+ aws_null_resource.default"
  }
}

function renderHclValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (Array.isArray(value) || typeof value === "object") {
    return `jsonencode(${JSON.stringify(value)})`
  }
  return `"${String(value)}"`
}

function toSnakeCase(key: string) {
  return key.replace(/([A-Z])/g, "_$1").replace(/-/g, "_").toLowerCase()
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

function getRegistryCommitSha() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.TFPILOT_APP_COMMIT ||
    "unknown"
  )
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

function validatePolicy(config: Record<string, unknown>) {
  const name =
    typeof config.name === "string" && config.name.trim()
      ? (config.name as string).trim()
      : typeof config.bucket_name === "string" && config.bucket_name.trim()
        ? (config.bucket_name as string).trim()
        : typeof config.queue_name === "string" && config.queue_name.trim()
          ? (config.queue_name as string).trim()
          : undefined

  if (name && !/^[a-z0-9-]{3,63}$/i.test(name)) {
    throw new Error("Resource name must be 3-63 chars, alphanumeric and dashes only")
  }

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
  const fields = ["name", "bucket_name", "queue_name", "service_name"]
  for (const field of fields) {
    const current = config[field]
    if (typeof current !== "string") continue
    const trimmed = current.trim()
    if (!trimmed) continue
    if (trimmed.includes(requestId)) continue

    const candidate = buildResourceName(trimmed, requestId)
    // AWS resource names must be lowercase
    config[field] = candidate.toLowerCase()
  }
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

function renderModuleBlock(request: StoredRequest, moduleSource: string) {
  const renderedInputs = Object.entries(request.config).map(([key, val]) => {
    if (key === "tags" && val && typeof val === "object" && !Array.isArray(val)) {
      const tagEntries = Object.entries(val as Record<string, unknown>).map(
        ([k, v]) => `    ${k} = ${renderHclValue(v)}`
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

function normalizeByFields(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) {
  const fields = buildFieldMap(entry)
  const allowed = new Set(Object.keys(fields))

  const initial: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawConfig ?? {})) {
    if (!allowed.has(k)) continue
    const field = fields[k]
    // Only skip readOnly fields (auto-populated by system)
    // Immutable fields should be included for initial creation, they just can't be changed later
    if (field.readOnly) continue
    initial[k] = coerceByType(field, v)
  }

  applyDefaults(fields, initial)
  validateEnum(fields, initial)

  const computed = entry.compute ? entry.compute(initial, ctx) : {}
  const merged = { ...initial, ...computed }

  const finalConfig: Record<string, unknown> = {}
  for (const k of Object.keys(fields)) {
    // Include from merged (initial + computed) if available
    if (merged[k] !== undefined) {
      finalConfig[k] = merged[k]
    } else {
      // For immutable/readOnly fields that were filtered out from initial, include from rawConfig if provided
      const field = fields[k]
      if (field && rawConfig[k] !== undefined) {
        // Include immutable fields (even if readOnly) from rawConfig for initial creation
        if (field.immutable || (field.readOnly && field.required)) {
          finalConfig[k] = coerceByType(field, rawConfig[k])
        }
      }
    }
  }

  // Derive 'name' from bucket_name/queue_name/service_name if not provided and name is required
  if (!finalConfig.name && fields.name?.required) {
    const nameFields = ['bucket_name', 'queue_name', 'service_name']
    for (const nameField of nameFields) {
      const value = finalConfig[nameField] || rawConfig[nameField]
      if (value && typeof value === 'string' && value.trim()) {
        finalConfig.name = value.trim()
        break
      }
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

async function generateTerraformFiles(
  token: string,
  request: StoredRequest,
  moduleType: ReturnType<typeof getModuleType>,
  envPath: string,
  owner: string,
  repo: string
) {
  const targetFile = getEnvTargetFile(envPath, moduleType)
  const moduleSource = `../../modules/${request.module}`

  const existing = await fetchRepoFile(token, owner, repo, targetFile)
  const beginMarker = `# --- tfpilot:begin:${request.id} ---`
  if (existing && existing.includes(beginMarker)) {
    throw new Error(`Request ${request.id} already exists in ${targetFile}`)
  }

  const block = renderModuleBlock(request, moduleSource)
  const updated = upsertRequestBlock(existing, request.id, block)

  return { files: [{ path: targetFile, content: updated }] }
}

async function createBranchCommitPrAndPlan(
  token: string,
  request: StoredRequest,
  files: Array<{ path: string; content: string }>,
  target: { owner: string; repo: string; base: string }
) {
  const branchName = `request/${request.id}`

  const refRes = await gh(token, `/repos/${target.owner}/${target.repo}/git/ref/heads/${target.base}`)
  const refJson = (await refRes.json()) as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) throw new Error("Failed to resolve base branch SHA")

  // create branch (ignore if exists)
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
      message: `chore: infra request ${request.id}`,
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
      title: `Infra request ${request.id}: ${request.module}`,
      head: branchName,
      base: target.base,
      body: `Automated request for ${request.project}/${request.environment}\n\nModule: ${request.module}\nRequest ID: ${request.id}`,
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
    const runsRes = await gh(
      token,
      `/repos/${target.owner}/${target.repo}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(
        branchName
      )}&per_page=1`
    )
    const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number }> }
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestPayload
    const errors = validatePayload(body)

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      )
    }

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }
    const role = getUserRole(session.login)
    if (role === "viewer") {
      return NextResponse.json({ success: false, error: "Insufficient role" }, { status: 403 })
    }

    // validate module exists based on registry
    const regEntry = moduleRegistry.find((m) => m.type === body.module)
    if (!regEntry) {
      return NextResponse.json({ success: false, error: "Unknown module" }, { status: 400 })
    }

    const token = await getGitHubAccessToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    const requestId = generateRequestId(body.environment!, body.module!)

    console.log("[api/requests] received payload:", body)
    console.log("[api/requests] Triggering generation for", requestId)
    console.log("[api/requests] module =", body.module)

    const moduleType = getModuleType(body.module!, regEntry.category)
    const targetRepo = resolveInfraRepo(body.project!, body.environment!)
    if (!targetRepo) {
      return NextResponse.json({ success: false, error: "No infra repo configured for project/environment" }, { status: 400 })
    }

    const isProd = body.environment?.toLowerCase() === "prod"
    if (isProd && env.TFPILOT_PROD_ALLOWED_USERS.length > 0) {
      if (!env.TFPILOT_PROD_ALLOWED_USERS.includes(session.login)) {
        return NextResponse.json({ success: false, error: "Prod deployments not allowed for this user" }, { status: 403 })
      }
    }

    const normalizedConfig = normalizeConfigKeys(body.config as Record<string, unknown>)

    const newRequest: StoredRequest = {
      id: requestId,
      project: body.project!,
      environment: body.environment!,
      module: body.module!,
      config: normalizedConfig,
      receivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
      status: "created",
      plan: { diff: planDiffForModule(body.module) },
    }

    newRequest.config = buildModuleConfig(regEntry, newRequest.config, {
      requestId: newRequest.id,
      project: newRequest.project,
      environment: newRequest.environment,
    })

    appendRequestIdToNames(newRequest.config, requestId)

    // Policy checks (naming, region allowlist)
    validatePolicy(newRequest.config)

    const generated = await generateTerraformFiles(
      token,
      newRequest,
      moduleType,
      targetRepo.envPath,
      targetRepo.owner,
      targetRepo.repo
    )
    const ghResult = await createBranchCommitPrAndPlan(token, newRequest, generated.files, targetRepo)

    const resolvedAt = new Date().toISOString()
    const moduleCommitSha = ghResult.baseSha ?? "unknown"
    const registryCommitSha = getRegistryCommitSha()
    newRequest.moduleRef = {
      repo: `${targetRepo.owner}/${targetRepo.repo}`,
      path: `modules/${newRequest.module}`,
      commitSha: moduleCommitSha,
      resolvedAt,
    }
    newRequest.registryRef = {
      commitSha: registryCommitSha,
      resolvedAt,
    }
    newRequest.rendererVersion = RENDERER_VERSION
    const renderPayload = {
      moduleCommit: moduleCommitSha,
      registryCommit: registryCommitSha,
      normalizedInputs: newRequest.config,
      rendererVersion: RENDERER_VERSION,
    }
    newRequest.render = {
      renderHash: `sha256:${sha256(stableStringify(renderPayload))}`,
      inputsHash: `sha256:${sha256(stableStringify(newRequest.config))}`,
      reproducible: true,
      computedAt: resolvedAt,
    }

    newRequest.branchName = ghResult.branchName
    newRequest.prNumber = ghResult.prNumber
    newRequest.prUrl = ghResult.prUrl
    newRequest.commitSha = ghResult.commitSha
    newRequest.activePrNumber = ghResult.prNumber
    newRequest.pr = {
      number: ghResult.prNumber,
      url: ghResult.prUrl,
      merged: false,
      headSha: ghResult.planHeadSha,
      open: true,
    }
    newRequest.status = "planning"
    newRequest.targetOwner = targetRepo.owner
    newRequest.targetRepo = targetRepo.repo
    newRequest.targetBase = targetRepo.base
    newRequest.targetEnvPath = targetRepo.envPath
    newRequest.targetFiles = generated.files.map((f) => f.path)
    newRequest.planRun = {
      runId: ghResult.planRunId,
      url: ghResult.planRunUrl,
      headSha: ghResult.planHeadSha,
    }

    const newRequestWithAssistant = ensureAssistantState(newRequest)

    await saveRequest(newRequestWithAssistant)

    await logLifecycleEvent({
      requestId,
      event: "plan_dispatched",
      actor: session.login,
      source: "api/requests",
      data: {
        branch: newRequestWithAssistant.branchName,
        planRunId: newRequestWithAssistant.planRun?.runId,
        planRunUrl: newRequestWithAssistant.planRun?.url,
        targetRepo: `${targetRepo.owner}/${targetRepo.repo}`,
      },
    })

    await logLifecycleEvent({
      requestId,
      event: "request_created",
      actor: session.login,
      source: "api/requests",
      data: {
        project: newRequestWithAssistant.project,
        environment: newRequestWithAssistant.environment,
        module: newRequestWithAssistant.module,
        targetRepo: `${targetRepo.owner}/${targetRepo.repo}`,
      },
    })

    return NextResponse.json({
      success: true,
      requestId,
      plan: newRequestWithAssistant.plan,
      prUrl: newRequestWithAssistant.prUrl,
    })
  } catch (error) {
    console.error("[api/requests] error parsing request:", error)
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Invalid JSON payload"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}

export async function GET(_req: NextRequest) {
  try {
    const requests: StoredRequest[] = (await listRequests()) as StoredRequest[]
    return NextResponse.json({
      success: true,
      requests,
    })
  } catch {
    return NextResponse.json({
      success: true,
      requests: [],
    })
  }
}