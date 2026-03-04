/**
 * Environment skeleton generator for deploy.
 * Creates Terraform root structure from environment template.
 * Pure function: no I/O, no GitHub, no PRs.
 */

import { environmentTemplates } from "@/config/environment-templates"
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
  /** Optional; deploy API passes from environment. Default "default" for standalone use. */
  project_key?: string
}

export type EnvSkeletonResult = {
  envRoot: string
  files: Array<{ path: string; content: string }>
}

/**
 * Generate environment skeleton file map from template.
 * No I/O. Returns path→content map for commit.
 */
export function envSkeleton(params: EnvSkeletonParams): EnvSkeletonResult {
  const { environment_key, environment_slug, template_id, project_key = "default" } = params
  const envRoot = `envs/${environment_key}/${environment_slug}`
  const files: Array<{ path: string; content: string }> = []

  const template = environmentTemplates.find((t) => t.id === template_id)
  if (!template) {
    throw new Error(`Unknown template_id: ${template_id}`)
  }

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
