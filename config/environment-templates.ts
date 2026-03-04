/**
 * Environment templates (v1) — static config per ENVIRONMENT_TEMPLATES_DELTA §5 and §11.1.
 * No S3, no DB. Module ids must match module registry keys.
 */

export type EnvironmentTemplate = {
  id: string
  label?: string
  description?: string
  modules: {
    module: string
    order: number
    defaultConfig?: Record<string, unknown>
  }[]
}

/** Environment templates. Modules sorted by order ascending. */
export const environmentTemplates: EnvironmentTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Start with an empty environment (no predefined modules).",
    modules: [],
  },
  {
    id: "baseline-ai-service",
    label: "Baseline AI Service",
    description: "ECR repo, CloudWatch logs, IAM role, and S3 bucket for AI/ML workloads.",
    modules: [
      { module: "ecr-repo", order: 1 },
      { module: "cloudwatch-log-group", order: 2 },
      { module: "iam-role", order: 3 },
      { module: "s3-bucket", order: 4 },
    ],
  },
  {
    id: "baseline-app-service",
    label: "Baseline App Service",
    description: "CloudWatch logs, IAM role, and S3 bucket for application services.",
    modules: [
      { module: "cloudwatch-log-group", order: 1 },
      { module: "iam-role", order: 2 },
      { module: "s3-bucket", order: 3 },
    ],
  },
  {
    id: "baseline-worker-service",
    label: "Baseline Worker Service",
    description: "CloudWatch logs, IAM role, and S3 bucket for background workers.",
    modules: [
      { module: "cloudwatch-log-group", order: 1 },
      { module: "iam-role", order: 2 },
      { module: "s3-bucket", order: 3 },
    ],
  },
]
