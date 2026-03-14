/**
 * Workspace skeleton generator for deploy.
 * Creates Terraform root structure from pinned workspace template (S3) and template_inputs.
 * No blank/legacy template; template loaded by exact id+version from workspace-templates-store.
 */

import { getWorkspaceTemplate } from "@/lib/workspace-templates-store"
import type {
  WorkspaceTemplateDocument,
  WorkspaceTemplateInput,
} from "@/lib/workspace-templates-store"
import { moduleRegistry } from "@/config/module-registry"
import { generateModel2RequestFile } from "@/lib/renderer/model2"
import { generateRequestId } from "@/lib/requests/id"

function backendTfContent(): string {
  return `terraform {
  backend "s3" {}
}
`
}

function providersTfContent(project_key: string, workspace_key: string): string {
  return `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "tfpilot"
      Project     = "${project_key}"
      Environment = "${workspace_key}"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for this workspace"
  default     = "eu-west-2"
}
`
}

function versionsTfContent(): string {
  return `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
`
}

function tfpilotBaseTfContent(): string {
  return `# Model 2 workspace root. Request files go in tfpilot/requests/
`
}

/** Map template input type to Terraform variable type. */
function tfVariableType(type: "string" | "number" | "boolean"): string {
  switch (type) {
    case "string":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "bool"
    default:
      return "string"
  }
}

/** Generate variables.tf from template inputs schema. Deterministic order by input key. */
function variablesTfContent(inputs: WorkspaceTemplateInput[]): string {
  if (!inputs.length) return ""
  const lines = inputs
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((inp) => {
      const type = tfVariableType(inp.type)
      const desc = inp.label ? `  description = "${inp.label.replace(/"/g, '\\"')}"\n` : ""
      const def =
        inp.default !== undefined
          ? `  default     = ${inp.type === "string" ? `"${String(inp.default).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : String(inp.default)}\n`
          : ""
      return `variable "${inp.key}" {\n  type        = ${type}\n${desc}${def}}`
    })
  return lines.join("\n\n") + "\n"
}

/** Generate terraform.tfvars from pinned template_inputs. Only keys declared in template.inputs. */
function terraformTfvarsContent(
  inputs: WorkspaceTemplateInput[],
  templateInputs: Record<string, unknown>
): string {
  if (!inputs.length) return ""
  const declaredKeys = new Set(inputs.map((i) => i.key))
  const lines: string[] = []
  for (const key of Array.from(declaredKeys).sort()) {
    const val = templateInputs[key]
    if (val === undefined) continue
    if (typeof val === "string") {
      lines.push(`${key} = "${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    } else if (typeof val === "number" || typeof val === "boolean") {
      lines.push(`${key} = ${String(val)}`)
    }
  }
  return lines.length ? lines.join("\n") + "\n" : ""
}

/**
 * Interpolate config values: replace "${var.key}" with value from templateInputs.
 * Does not mutate config.
 */
function interpolateConfig(
  config: Record<string, unknown>,
  templateInputs: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === "string" && /^\$\{var\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/.test(v)) {
      const key = v.slice(6, -1)
      out[k] = key in templateInputs ? templateInputs[key] : v
    } else {
      out[k] = v
    }
  }
  return out
}

function assertPinnedWorkspaceTemplate(
  template_id: string,
  template_version: string,
  template_inputs: unknown
): void {
  if (typeof template_id !== "string" || template_id.trim() === "") {
    throw new Error("Workspace template_id is required and must be non-empty")
  }
  if (typeof template_version !== "string" || template_version.trim() === "") {
    throw new Error("Workspace template_version is required and must be non-empty")
  }
  if (
    template_inputs == null ||
    typeof template_inputs !== "object" ||
    Array.isArray(template_inputs)
  ) {
    throw new Error("Workspace template_inputs must be an object")
  }
}

/** Optional test-only: override template loader. When set, used instead of getWorkspaceTemplate. */
export type WorkspaceSkeletonParams = {
  workspace_key: string
  workspace_slug: string
  template_id: string
  template_version: string
  template_inputs: Record<string, unknown>
  project_key?: string
  /** @internal Test-only: inject template loader to avoid S3 in unit tests. */
  _getTemplate?: (templateId: string, version: string) => Promise<WorkspaceTemplateDocument>
}

export type WorkspaceSkeletonResult = {
  wsRoot: string
  files: Array<{ path: string; content: string }>
}

/**
 * Generate workspace skeleton from pinned template (S3) and pinned template_inputs.
 * Loads exact template by id+version; uses workspace.template_inputs as final values.
 * Generates variables.tf and terraform.tfvars when template defines inputs.
 */
export async function workspaceSkeleton(
  params: WorkspaceSkeletonParams
): Promise<WorkspaceSkeletonResult> {
  const {
    workspace_key,
    workspace_slug,
    template_id,
    template_version,
    template_inputs,
    project_key = "default",
    _getTemplate,
  } = params

  assertPinnedWorkspaceTemplate(template_id, template_version, template_inputs)
  const tid = template_id.trim()
  const tver = template_version.trim()

  const loadTemplate = _getTemplate ?? getWorkspaceTemplate
  let template: WorkspaceTemplateDocument
  try {
    template = await loadTemplate(tid, tver)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Template document missing for ${tid}@${tver}: ${msg}`)
  }

  const wsRoot = `envs/${workspace_key}/${workspace_slug}`
  const files: Array<{ path: string; content: string }> = []

  files.push({ path: `${wsRoot}/backend.tf`, content: backendTfContent() })
  files.push({
    path: `${wsRoot}/providers.tf`,
    content: providersTfContent(project_key, workspace_key),
  })
  files.push({ path: `${wsRoot}/versions.tf`, content: versionsTfContent() })
  files.push({ path: `${wsRoot}/tfpilot/base.tf`, content: tfpilotBaseTfContent() })
  files.push({ path: `${wsRoot}/tfpilot/requests/.gitkeep`, content: "" })

  const inputs = template.inputs ?? []
  if (inputs.length > 0) {
    files.push({
      path: `${wsRoot}/variables.tf`,
      content: variablesTfContent(inputs),
    })
    const tfvars = terraformTfvarsContent(inputs, template_inputs)
    if (tfvars) {
      files.push({
        path: `${wsRoot}/terraform.tfvars`,
        content: tfvars,
      })
    }
  }

  for (const mod of template.modules) {
    const regEntry = moduleRegistry.find((m) => m.type === mod.id)
    if (!regEntry) {
      throw new Error(`Module ${mod.id} not in registry`)
    }
    const fullRequestId = generateRequestId(workspace_key, mod.id)
    const pathId = fullRequestId.startsWith("req_") ? fullRequestId.slice(4) : fullRequestId
    const interpolated = interpolateConfig(mod.config, template_inputs)
    const rawConfig: Record<string, unknown> = { ...interpolated }
    if (rawConfig.name == null || rawConfig.name === "") {
      rawConfig.name = `${workspace_slug}-${mod.id}`
    }
    for (const field of regEntry.fields) {
      if (rawConfig[field.name] === undefined && field.default !== undefined) {
        rawConfig[field.name] = field.default
      }
    }
    if (rawConfig.tags === undefined) {
      rawConfig.tags = {}
    }
    const ctx = {
      requestId: fullRequestId,
      project_key,
      environment_key: workspace_key,
    }
    const config = regEntry.compute ? regEntry.compute(rawConfig, ctx) : rawConfig
    const { path, content } = generateModel2RequestFile(workspace_key, workspace_slug, {
      id: pathId,
      module: mod.id,
      config: config as Record<string, unknown>,
    })
    files.push({ path, content })
  }

  return { wsRoot, files }
}
