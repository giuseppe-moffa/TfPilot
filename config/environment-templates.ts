/**
 * Environment templates (v1) — static config per ENVIRONMENT_TEMPLATES_DELTA §5 and §11.1.
 * No S3, no DB. Module ids must match module registry keys.
 */

export type EnvironmentTemplate = {
  id: string
  label?: string
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
    modules: [],
  },
  {
    id: "baseline-ai-service",
    label: "Baseline AI Service",
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
    modules: [
      { module: "cloudwatch-log-group", order: 1 },
      { module: "iam-role", order: 2 },
      { module: "s3-bucket", order: 3 },
    ],
  },
  {
    id: "baseline-worker-service",
    label: "Baseline Worker Service",
    modules: [
      { module: "cloudwatch-log-group", order: 1 },
      { module: "iam-role", order: 2 },
      { module: "s3-bucket", order: 3 },
    ],
  },
]
