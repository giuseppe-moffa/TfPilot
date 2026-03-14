import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

import { gh } from "@/lib/github/client"
import { getGitHubAccessToken } from "@/lib/github/auth"
import { githubRequest } from "@/lib/github/rateAware"
import { getModuleType } from "@/lib/infra/moduleType"
import { generateModel2RequestFile } from "@/lib/renderer/model2"
import { env, logEnvDebug } from "@/lib/config/env"
import { saveRequest, getRequest } from "@/lib/storage/requestsStore"
import {
  listRequestIndexRowsPage,
  encodeCursor,
  decodeCursor,
  MAX_LIST_LIMIT,
  type RequestIndexRow,
  type CursorPayload,
} from "@/lib/db/requestsList"
import { computeDocHash, type RequestDocForIndex } from "@/lib/db/indexer"
import { moduleRegistry, type ModuleRegistryEntry, type ModuleField } from "@/config/module-registry"
import { generateRequestId } from "@/lib/requests/id"
import { deriveLifecycleStatus } from "@/lib/requests/deriveLifecycleStatus"
import { buildResourceName } from "@/lib/requests/naming"
import { normalizeName, validateResourceName } from "@/lib/validation/resourceName"
import { injectServerAuthoritativeTags, assertRequiredTagsPresent } from "@/lib/requests/tags"
import { getSessionFromCookies, requireSession, type SessionPayload } from "@/lib/auth/session"
import { requireActiveOrg } from "@/lib/auth/requireActiveOrg"
import { withCorrelation } from "@/lib/observability/correlation"
import { logError, logInfo, logWarn, timeAsync } from "@/lib/observability/logger"
import {
  getIdempotencyKey,
  checkCreateIdempotency,
  recordCreate,
} from "@/lib/requests/idempotency"
import { logLifecycleEvent } from "@/lib/logs/lifecycle"
import { putPrIndex } from "@/lib/requests/prIndex"
import { getCurrentAttemptStrict, patchAttemptRunId, persistDispatchAttempt } from "@/lib/requests/runsModel"
import type { RunsState } from "@/lib/requests/runsModel"
import { putRunIndex } from "@/lib/requests/runIndex"
import {
  buildPermissionContext,
  requireProjectPermission,
  PermissionDeniedError,
} from "@/lib/auth/permissions"
import { getProjectByKey } from "@/lib/db/projects"
import { ensureAssistantState } from "@/lib/assistant/state"
import {
  resolveRequestWorkspace,
  type ResolveRequestWorkspaceResult,
  type ResolvedRequestWorkspace,
} from "@/lib/requests/resolveRequestWorkspace"
import { validateCreateBody } from "@/lib/requests/validateCreateBody"
import { writeAuditEvent, auditWriteDeps } from "@/lib/audit/write"
import type { PermissionContext, ProjectPermission } from "@/lib/auth/permissions"
import type { CheckCreateResult } from "@/lib/requests/idempotency"

type RequestPayload = {
  workspace_id?: string
  project_key?: string
  workspace_key?: string
  workspace_slug?: string
  module?: string
  config?: Record<string, unknown>
  templateId?: string
  environmentName?: string
}

type StoredRequest = {
  id: string
  org_id: string
  project_key: string
  workspace_key: string
  workspace_slug: string
  workspace_id: string
  module: string
  config: Record<string, unknown>
  receivedAt: string
  updatedAt: string
  status: string
  revision?: number
  reason?: string
  statusDerivedAt?: string
  plan?: { diff: string }
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
  templateId?: string
  environmentName?: string
  cost?: {
    monthlyCost?: number
    diffSummary?: string
    lastUpdated?: string
  }
  /** Idempotency keys per operation (create, apply, destroy, etc.). Additive; optional. */
  idempotency?: Record<string, { key: string; at: string }>
  /** Optional lock during mutations (holder, operation, acquiredAt, expiresAt). */
  lock?: {
    holder: string
    operation: string
    acquiredAt: string
    expiresAt: string
  }
}

const PLAN_WORKFLOW = env.GITHUB_PLAN_WORKFLOW_FILE
const RENDERER_VERSION = "tfpilot-renderer@1"
logEnvDebug()

function validatePayload(body: RequestPayload): string[] {
  return validateCreateBody(body)
}

function planDiffForModule(mod?: string) {
  switch (mod) {
    case "s3-bucket":
      return "+ aws_s3_bucket.main"
    case "ec2-instance":
      return "+ aws_instance.this"
    case "ecr-repo":
      return "+ aws_ecr_repository.this"
    default:
      return "+ aws_null_resource.default"
  }
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

function normalizeByFields(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project_key: string; environment_key: string }) {
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
    if (merged[k] !== undefined) {
      finalConfig[k] = merged[k]
    } else {
      const field = fields[k]
      if (field && rawConfig[k] !== undefined) {
        if (field.immutable || (field.readOnly && field.required)) {
          finalConfig[k] = coerceByType(field, rawConfig[k])
        }
      }
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

function buildModuleConfig(entry: ModuleRegistryEntry, rawConfig: Record<string, unknown>, ctx: { requestId: string; project_key: string; environment_key: string }) {
  if (!entry.fields || entry.fields.length === 0) {
    throw new Error(`Module ${entry.type} missing fields schema (schema contract v2 required)`)
  }
  const cfg: Record<string, unknown> = { ...(rawConfig ?? {}) }
  return normalizeByFields(entry, cfg, ctx)
}

async function generateModel2TerraformFiles(
  token: string,
  environment_key: string,
  environment_slug: string,
  request: StoredRequest,
  owner: string,
  repo: string
) {
  const { path, content } = generateModel2RequestFile(environment_key, environment_slug, {
    id: request.id,
    module: request.module,
    config: request.config,
  })
  const existing = await fetchRepoFile(token, owner, repo, path)
  if (existing) {
    throw new Error(`Request ${request.id} already exists at ${path}`)
  }
  return { files: [{ path, content }] }
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
      body: `Automated request for ${request.project_key}/${request.workspace_key}/${request.workspace_slug}\n\nModule: ${request.module}\nRequest ID: ${request.id}`,
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
        environment_key: request.workspace_key,
        environment_slug: request.workspace_slug,
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
      path: `/repos/${target.owner}/${target.repo}/actions/workflows/${PLAN_WORKFLOW}/runs?branch=${encodeURIComponent(
        branchName
      )}&per_page=1`,
      context: { route: "requests" },
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
    workflowRunId,
    workflowRunUrl,
    baseSha,
  }
}

type GenerateModel2Result = { files: Array<{ path: string; content: string }> }
type CreateBranchResult = {
  branchName: string
  prNumber: number
  prUrl: string
  commitSha?: string
  planHeadSha?: string
  workflowRunId?: number
  workflowRunUrl?: string
  baseSha?: string
}

export type RequestsPOSTDeps = {
  getSessionFromCookies: () => Promise<SessionPayload | null>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  getGitHubAccessToken: (req: NextRequest) => Promise<string | null>
  getIdempotencyKey: (req: NextRequest) => string | null
  checkCreateIdempotency: (key: string, now: Date) => CheckCreateResult
  resolveRequestWorkspace: (input: {
    workspace_id?: string
    project_key?: string
    workspace_key?: string
    workspace_slug?: string
    orgId?: string
    _deps?: import("@/lib/requests/resolveRequestWorkspace").ResolveRequestWorkspaceDeps
  }) => Promise<ResolveRequestWorkspaceResult>
  getProjectByKey: (orgId: string, projectKey: string) => Promise<{ id: string; orgId: string } | null>
  buildPermissionContext: (login: string, orgId: string) => Promise<PermissionContext>
  requireProjectPermission: (
    ctx: PermissionContext,
    projectId: string,
    permission: "plan"
  ) => Promise<unknown>
  generateModel2TerraformFiles: (
    token: string,
    envKey: string,
    envSlug: string,
    request: StoredRequest,
    owner: string,
    repo: string
  ) => Promise<GenerateModel2Result>
  createBranchCommitPrAndPlan: (
    token: string,
    request: StoredRequest,
    files: Array<{ path: string; content: string }>,
    target: { owner: string; repo: string; base: string }
  ) => Promise<CreateBranchResult>
  saveRequest: (doc: unknown) => Promise<void>
  recordCreate: (key: string, requestId: string, requestDoc: Record<string, unknown>, now: Date) => void
}

const realRequestsPOSTDeps: RequestsPOSTDeps = {
  getSessionFromCookies,
  requireActiveOrg,
  getGitHubAccessToken,
  getIdempotencyKey,
  checkCreateIdempotency,
  resolveRequestWorkspace,
  getProjectByKey,
  buildPermissionContext,
  requireProjectPermission,
  generateModel2TerraformFiles,
  createBranchCommitPrAndPlan,
  saveRequest,
  recordCreate,
}

export function makeRequestsPOST(deps: RequestsPOSTDeps) {
  return async function POST(request: NextRequest) {
  const start = Date.now()
  const correlation = withCorrelation(request, {})
  let userLogin: string | undefined
  try {
    const body = (await request.json()) as RequestPayload
    const errors = validatePayload(body)

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      )
    }

    const session = await deps.getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }
    userLogin = session.login
    if (!session.orgId) {
      return NextResponse.json({ success: false, error: "No org context" }, { status: 403 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes

    // validate module exists based on registry
    const regEntry = moduleRegistry.find((m) => m.type === body.module)
    if (!regEntry) {
      return NextResponse.json({ success: false, error: "Unknown module" }, { status: 400 })
    }

    const token = await deps.getGitHubAccessToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: "GitHub not connected" }, { status: 401 })
    }

    const idemKey = deps.getIdempotencyKey(request)
    const now = new Date()
    const createCheck = deps.checkCreateIdempotency(idemKey ?? "", now)
    if (createCheck.ok === false && createCheck.mode === "replay") {
      const replayId = (createCheck.requestDoc as { id?: string }).id
      logInfo("idempotency.replay", { ...correlation, operation: "create", requestId: replayId })
      return NextResponse.json(
        { success: true, request: createCheck.requestDoc },
        { status: 201 }
      )
    }

    const envResult = await deps.resolveRequestWorkspace({
      workspace_id: body.workspace_id,
      project_key: body.project_key,
      workspace_key: body.workspace_key,
      workspace_slug: body.workspace_slug,
      orgId: session.orgId!,
    })
    if (!envResult.ok) {
      return NextResponse.json({ success: false, error: envResult.error }, { status: 400 })
    }
    const { resolved } = envResult

    const project = await deps.getProjectByKey(session.orgId!, resolved.project_key)
    if (!project || project.orgId !== session.orgId) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
    }
    const ctx = await deps.buildPermissionContext(session.login, session.orgId!)
    try {
      await deps.requireProjectPermission(ctx, project.id, "plan")
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
      }
      throw e
    }

    const targetRepo = resolved.targetRepo

    const requestId = generateRequestId(resolved.workspace_key, body.module!)
    logInfo("request.create", { ...correlation, requestId, user: userLogin })

    console.log("[api/requests] received payload:", body)
    console.log("[api/requests] Triggering generation for", requestId)
    console.log("[api/requests] module =", body.module)

    getModuleType(body.module!, regEntry.category)

    const normalizedConfig = normalizeConfigKeys(body.config as Record<string, unknown>)
    if (typeof normalizedConfig.name === "string") {
      normalizedConfig.name = normalizeName(normalizedConfig.name)
    }

    const nowIso = new Date().toISOString()
    const newRequest: StoredRequest = {
      id: requestId,
      org_id: session.orgId,
      project_key: resolved.project_key,
      workspace_key: resolved.workspace_key,
      workspace_slug: resolved.workspace_slug,
      workspace_id: resolved.workspace_id!,
      module: body.module!,
      config: normalizedConfig,
      receivedAt: nowIso,
      updatedAt: nowIso,
      revision: 1,
      status: "created",
      plan: { diff: planDiffForModule(body.module) },
    }
    if (process.env.NODE_ENV !== "production") {
      if (!resolved.workspace_key || !resolved.workspace_slug) {
        throw new Error("[DEV] Request create: workspace_key and workspace_slug required (Model 2)")
      }
    }
    if (!resolved.workspace_id || !resolved.workspace_key || !resolved.workspace_slug) {
      return NextResponse.json(
        { success: false, error: "Workspace resolution must produce workspace_id, workspace_key, workspace_slug" },
        { status: 400 }
      )
    }
    ;(newRequest as Record<string, unknown>).lastActionAt = nowIso
    if (body.templateId != null) newRequest.templateId = String(body.templateId)
    if (typeof body.environmentName === "string" && body.environmentName.trim())
      newRequest.environmentName = body.environmentName.trim()

    newRequest.config = buildModuleConfig(regEntry, newRequest.config, {
      requestId: newRequest.id,
      project_key: newRequest.project_key,
      environment_key: newRequest.workspace_key,
    })

    appendRequestIdToNames(newRequest.config, requestId)

    // Server-authoritative tags: always inject required keys; required overwrite any incoming tags.
    injectServerAuthoritativeTags(newRequest.config, newRequest, session.login)
    assertRequiredTagsPresent(newRequest.config, newRequest)

    const nameVal = typeof newRequest.config.name === "string" ? newRequest.config.name : ""
    if (nameVal) {
      const nameResult = validateResourceName(nameVal)
      if (!nameResult.ok) {
        return NextResponse.json({ fieldErrors: { name: nameResult.error } }, { status: 400 })
      }
    }
    validatePolicy(newRequest.config)

    const generated = await deps.generateModel2TerraformFiles(
      token,
      resolved.workspace_key,
      resolved.workspace_slug,
      newRequest,
      targetRepo.owner,
      targetRepo.repo
    )
    const ghResult = await deps.createBranchCommitPrAndPlan(token, newRequest, generated.files, targetRepo)

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
    newRequest.targetOwner = targetRepo.owner
    newRequest.targetRepo = targetRepo.repo
    newRequest.targetBase = targetRepo.base
    newRequest.targetEnvPath = resolved.targetRepo.envPath
    newRequest.targetFiles = generated.files.map((f) => f.path)
    const runsPatch = persistDispatchAttempt(newRequest as Record<string, unknown>, "plan", {
      headSha: ghResult.planHeadSha,
      actor: session.login,
      ref: ghResult.branchName,
    })
    ;(newRequest as Record<string, unknown>).runs = runsPatch.runs
    ;(newRequest as Record<string, unknown>).updatedAt = runsPatch.updatedAt

    if (ghResult.workflowRunId != null && ghResult.workflowRunUrl != null) {
      const runs = (newRequest as Record<string, unknown>).runs as RunsState
      const currentAttemptNum = runs?.plan?.currentAttempt ?? 0
      if (currentAttemptNum > 0) {
        const patched = patchAttemptRunId(runs, "plan", currentAttemptNum, {
          runId: ghResult.workflowRunId,
          url: ghResult.workflowRunUrl,
        })
        if (patched) {
          ;(newRequest as Record<string, unknown>).runs = patched
        }
      }
    }

    const newRequestWithAssistant = ensureAssistantState(newRequest)

    await deps.saveRequest(newRequestWithAssistant)
    if (idemKey) deps.recordCreate(idemKey, requestId, newRequestWithAssistant as Record<string, unknown>, now)

    writeAuditEvent(auditWriteDeps, {
      org_id: session.orgId!,
      actor_login: session.login,
      source: "user",
      event_type: "request_created",
      entity_type: "request",
      entity_id: requestId,
      request_id: requestId,
      project_key: newRequestWithAssistant.project_key,
      workspace_id: newRequestWithAssistant.workspace_id,
      metadata: { project_key: newRequestWithAssistant.project_key, workspace_id: newRequestWithAssistant.workspace_id, module: newRequestWithAssistant.module },
    }).catch(() => {})

    await putPrIndex(targetRepo.owner, targetRepo.repo, ghResult.prNumber, requestId).catch(() => {})
    if (ghResult.workflowRunId != null) {
      putRunIndex("plan", ghResult.workflowRunId, requestId).catch(() => {})
    }

    const planAttempt = getCurrentAttemptStrict((newRequestWithAssistant as { runs?: RunsState }).runs, "plan")
    await logLifecycleEvent({
      requestId,
      event: "plan_dispatched",
      actor: session.login,
      source: "api/requests",
      data: {
        branch: newRequestWithAssistant.branchName,
        runId: planAttempt?.runId ?? ghResult.workflowRunId,
        url: planAttempt?.url ?? ghResult.workflowRunUrl,
        targetRepo: `${targetRepo.owner}/${targetRepo.repo}`,
      },
    })

    await logLifecycleEvent({
      requestId,
      event: "request_created",
      actor: session.login,
      source: "api/requests",
      data: {
        project: newRequestWithAssistant.project_key,
        workspace: newRequestWithAssistant.workspace_key,
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
    logError("request.create_failed", error, { ...correlation, user: userLogin, duration_ms: Date.now() - start })
    const err = error as { status?: number; message?: string }
    if (err?.status === 403 || (typeof err?.message === "string" && err.message.includes("Resource not accessible by integration"))) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GitHub denied write access to the repo. Sign out and sign in again, and when GitHub asks, grant repo (write) access. If using a GitHub App: ensure it has Contents → Read and write (Permissions & events). For org repos, an admin must approve the app under Third-party access.",
        },
        { status: 403 }
      )
    }
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Invalid JSON payload"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
  }
}

export const POST = makeRequestsPOST(realRequestsPOSTDeps)

/** Dependencies for GET /api/requests list handler. Injected for testability. */
export type RequestsListRouteDeps = {
  requireSession: () => Promise<SessionPayload | NextResponse>
  requireActiveOrg: (session: SessionPayload) => Promise<NextResponse | null>
  listRequestIndexRowsPage: (opts: {
    orgId: string
    limit: number
    cursor: string | null
  }) => Promise<RequestIndexRow[] | null>
  getRequest: (requestId: string) => Promise<Record<string, unknown>>
  computeDocHash: (doc: RequestDocForIndex) => string
  deriveLifecycleStatus: (doc: Record<string, unknown>) => string
  encodeCursor: (payload: CursorPayload) => string
  decodeCursor: (cursor: string) => CursorPayload | null
  MAX_LIST_LIMIT: number
}

const requestsListRealDeps: RequestsListRouteDeps = {
  requireSession,
  requireActiveOrg,
  listRequestIndexRowsPage,
  getRequest,
  computeDocHash,
  deriveLifecycleStatus,
  encodeCursor,
  decodeCursor,
  MAX_LIST_LIMIT,
}

/** Factory for testability; requestsListRealDeps used in runtime export. */
export function makeRequestsGET(deps: RequestsListRouteDeps) {
  return async function GET(req: NextRequest) {
    const sessionOr401 = await deps.requireSession()
    if (sessionOr401 instanceof NextResponse) return sessionOr401
    const session = sessionOr401
    if (!session.orgId) {
      return NextResponse.json({ success: false, error: "No org context" }, { status: 403 })
    }
    const archivedRes = await deps.requireActiveOrg(session)
    if (archivedRes) return archivedRes
    const correlation = withCorrelation(req, {})

    const limitParam = req.nextUrl.searchParams.get("limit")
    const limitRaw = limitParam != null ? parseInt(limitParam, 10) : 50
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), deps.MAX_LIST_LIMIT) : 50
    const cursorParam = req.nextUrl.searchParams.get("cursor") ?? null
    const cursor = cursorParam != null && cursorParam.trim() !== "" ? cursorParam.trim() : null
    if (cursor != null && deps.decodeCursor(cursor) === null) {
      return NextResponse.json(
        { success: false, error: "Invalid or malformed cursor" },
        { status: 400 }
      )
    }

    let indexRows: RequestIndexRow[] | null
    try {
      indexRows = await deps.listRequestIndexRowsPage({ orgId: session.orgId, limit: limit + 1, cursor })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { success: false, error: `Database unreachable: ${message}` },
        { status: 503 }
      )
    }
    if (indexRows === null) {
      return NextResponse.json(
        { success: false, error: "Database not configured; list requires Postgres" },
        { status: 503 }
      )
    }

    const pageRows = indexRows.slice(0, limit)

    // UI: treat each page as a "latest snapshot"; no global consistency across pages (new requests between fetches can shift items).
    try {
      return await timeAsync("request.list", correlation, async () => {
        const driftLogged = new Set<string>()
        const missingLogged = new Set<string>()
        const list_errors: { request_id: string; error: string; index_updated_at: string }[] = []

        const isNoSuchKey = (e: unknown): boolean => {
          const err = e as { name?: string; message?: string; Code?: string }
          return (
            err?.name === "NoSuchKey" ||
            err?.Code === "NoSuchKey" ||
            (typeof err?.message === "string" && err.message.includes("The specified key does not exist"))
          )
        }

        const results = await Promise.all(
          pageRows.map(async (row) => {
            try {
              const doc = await deps.getRequest(row.request_id)
              return { ok: true as const, row, doc }
            } catch (e) {
              return { ok: false as const, row, error: e, isNoSuchKey: isNoSuchKey(e) }
            }
          })
        )

        const requests: unknown[] = []
        for (const r of results) {
          if (r.ok) {
            const { row, doc } = r
            const base = {
              ...doc,
              status: deps.deriveLifecycleStatus(doc),
              index_projection_updated_at: row.updated_at,
              index_projection_last_activity_at: row.last_activity_at ?? row.updated_at,
            }
            const indexDocHash = row.doc_hash ?? null
            const s3DocHash = deps.computeDocHash(doc as RequestDocForIndex)
            const drift = indexDocHash != null && s3DocHash !== indexDocHash
            if (drift) {
              if (!driftLogged.has(row.request_id)) {
                driftLogged.add(row.request_id)
                logWarn("request.list", undefined, { requestId: row.request_id, index_doc_hash: indexDocHash, s3_doc_hash: s3DocHash, message: "index drift detected" })
              }
              requests.push({
                ...base,
                index_drift: true,
                index_doc_hash: indexDocHash,
                s3_doc_hash: s3DocHash,
              })
            } else {
              requests.push(base)
            }
          } else {
            if (r.isNoSuchKey) {
              list_errors.push({ request_id: r.row.request_id, error: "NoSuchKey", index_updated_at: r.row.updated_at })
              if (!missingLogged.has(r.row.request_id)) {
                missingLogged.add(r.row.request_id)
                logWarn("request.list_missing_s3_doc", undefined, { requestId: r.row.request_id, correlationId: correlation?.correlationId })
              }
            } else {
              throw r.error
            }
          }
        }

        const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null
        const sortKey = lastRow ? (lastRow.last_activity_at ?? lastRow.updated_at) : null
        const next_cursor =
          lastRow != null && sortKey != null && indexRows.length > limit
            ? deps.encodeCursor({
                sort_key: sortKey,
                request_id: lastRow.request_id,
              })
            : null
        return NextResponse.json({
          success: true,
          requests,
          next_cursor,
          list_errors,
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      )
    }
  }
}

export const GET = makeRequestsGET(requestsListRealDeps)