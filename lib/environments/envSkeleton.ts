/**
 * Environment skeleton generator for deploy.
 * Creates Terraform root structure from environment template.
 * Step 7: Resolves templates from S3 (non-blank) or built-in "blank". No static config.
 */

import { getEnvTemplate } from "@/lib/env-templates-store"
import { INVALID_ENV_TEMPLATE } from "@/lib/environments/validateTemplateId"
import { moduleRegistry } from "@/config/module-registry"
import { generateModel2RequestFile } from "@/lib/renderer/model2"
import { generateRequestId } from "@/lib/requests/id"

function backendTfContent(): string {
  return `terraform {
  backend "s3" {}
}
`
}

function providersTfContent(project_key: string, environment_key: string): string {
  return `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "tfpilot"
      Project     = "${project_key}"
      Environment = "${environment_key}"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for this environment"
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
  return `# Model 2 environment root. Request files go in tfpilot/requests/
`
}

export type EnvSkeletonParams = {
  environment_key: string
  environment_slug: string
  template_id: string
  /** Org id from session; required for S3 template lookup. */
  orgId: string
  /** Optional; deploy API passes from environment. Default "default" for standalone use. */
  project_key?: string
}

export type EnvSkeletonResult = {
  envRoot: string
  files: Array<{ path: string; content: string }>
}

/** Built-in blank template; no S3 lookup. */
const BLANK_TEMPLATE = { modules: [] as { module: string; order: number; defaultConfig?: Record<string, unknown> }[] }

/**
 * Generate environment skeleton file map from template.
 * Assumes validateTemplateIdOrThrow already ran. Blank → built-in; non-blank → S3.
 */
export async function envSkeleton(params: EnvSkeletonParams): Promise<EnvSkeletonResult> {
  const { environment_key, environment_slug, template_id, orgId, project_key = "default" } = params
  const tid = (template_id ?? "blank").trim()
  const envRoot = `envs/${environment_key}/${environment_slug}`
  const files: Array<{ path: string; content: string }> = []

  const template =
    tid === "blank"
      ? BLANK_TEMPLATE
      : await (async () => {
          try {
            return await getEnvTemplate(orgId, tid)
          } catch (err: unknown) {
            if ((err as { name?: string })?.name === "NoSuchKey") {
              const e = new Error(INVALID_ENV_TEMPLATE) as Error & { code?: string }
              e.code = INVALID_ENV_TEMPLATE
              throw e
            }
            throw err
          }
        })()

  files.push({ path: `${envRoot}/backend.tf`, content: backendTfContent() })
  files.push({
    path: `${envRoot}/providers.tf`,
    content: providersTfContent(project_key, environment_key),
  })
  files.push({ path: `${envRoot}/versions.tf`, content: versionsTfContent() })
  files.push({ path: `${envRoot}/tfpilot/base.tf`, content: tfpilotBaseTfContent() })
  files.push({ path: `${envRoot}/tfpilot/requests/.gitkeep`, content: "" })

  const modulesSorted = [...template.modules].sort((a, b) => a.order - b.order)

  for (const mod of modulesSorted) {
    const regEntry = moduleRegistry.find((m) => m.type === mod.module)
    if (!regEntry) {
      throw new Error(`Module ${mod.module} not in registry`)
    }
    const fullRequestId = generateRequestId(environment_key, mod.module)
    const pathId = fullRequestId.startsWith("req_") ? fullRequestId.slice(4) : fullRequestId
    const rawConfig: Record<string, unknown> = { ...(mod.defaultConfig ?? {}) }
    if (rawConfig.name == null || rawConfig.name === "") {
      rawConfig.name = `${environment_slug}-${mod.module}`
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
      environment_key,
    }
    const config = regEntry.compute ? regEntry.compute(rawConfig, ctx) : rawConfig
    const { path, content } = generateModel2RequestFile(environment_key, environment_slug, {
      id: pathId,
      module: mod.module,
      config: config as Record<string, unknown>,
    })
    files.push({ path, content })
  }

  return { envRoot, files }
}
