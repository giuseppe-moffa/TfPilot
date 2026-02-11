export type ModuleRegistryEntry = {
  type: string
  category?: string
  description?: string
  required: string[]
  optional: string[]
  defaults?: Record<string, unknown>
  strip?: string[]
  compute?: (config: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) => Record<string, unknown>
  fieldTypes?: Record<string, "string" | "number" | "boolean" | "map" | "list">
}

export const moduleRegistry: ModuleRegistryEntry[] = [
  {
    type: "s3-bucket",
    category: "storage",
    description: "S3 bucket",
    required: ["name", "project", "environment", "request_id", "tags"],
    optional: ["bucket_name", "versioning_enabled", "force_destroy", "kms_key_arn"],
    defaults: { versioning_enabled: true },
    strip: ["region", "acl", "encryption_enabled", "encryption_type", "block_public_access", "public"],
    fieldTypes: {
      name: "string",
      project: "string",
      environment: "string",
      request_id: "string",
      bucket_name: "string",
      versioning_enabled: "boolean",
      force_destroy: "boolean",
      kms_key_arn: "string",
      tags: "map",
    },
    compute: (config, ctx) => {
      const nameFromConfig = typeof config.name === "string" && config.name.trim() ? config.name.trim() : undefined
      const bucketFromConfig =
        typeof config.bucket_name === "string" && config.bucket_name.trim() ? (config.bucket_name as string).trim() : undefined
      const name = nameFromConfig ?? bucketFromConfig ?? `req-${ctx.requestId.toLowerCase()}`
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        name,
        project: ctx.project,
        environment: ctx.environment,
        request_id: ctx.requestId,
        tags: {
          ManagedBy: "tfpilot",
          TfPilotRequestId: ctx.requestId,
          Project: ctx.project,
          Environment: ctx.environment,
          ...userTags,
        },
      }
    },
  },
  {
    type: "sqs-queue",
    category: "messaging",
    description: "SQS queue",
    required: ["name", "project", "environment", "request_id", "tags"],
    optional: [
      "fifo",
      "dlq_enabled",
      "max_receive_count",
      "message_retention_seconds",
      "dlq_message_retention_seconds",
      "visibility_timeout_seconds",
      "receive_wait_time_seconds",
      "kms_key_id",
    ],
    defaults: {
      dlq_enabled: true,
      max_receive_count: 5,
      message_retention_seconds: 345600,
      dlq_message_retention_seconds: 1209600,
      visibility_timeout_seconds: 30,
      receive_wait_time_seconds: 20,
    },
    fieldTypes: {
      name: "string",
      project: "string",
      environment: "string",
      request_id: "string",
      fifo: "boolean",
      dlq_enabled: "boolean",
      max_receive_count: "number",
      message_retention_seconds: "number",
      dlq_message_retention_seconds: "number",
      visibility_timeout_seconds: "number",
      receive_wait_time_seconds: "number",
      kms_key_id: "string",
      tags: "map",
    },
    strip: [],
    compute: (config, ctx) => {
      const nameFromConfig = typeof config.name === "string" && config.name.trim() ? config.name.trim() : undefined
      const name = nameFromConfig ?? `req-${ctx.requestId.toLowerCase()}`
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        name,
        project: ctx.project,
        environment: ctx.environment,
        request_id: ctx.requestId,
        tags: {
          ManagedBy: "tfpilot",
          TfPilotRequestId: ctx.requestId,
          Project: ctx.project,
          Environment: ctx.environment,
          ...userTags,
        },
      }
    },
  },
  {
    type: "ecs-service",
    category: "compute",
    description: "ECS service",
    required: ["name", "project", "environment", "request_id", "cluster_arn", "container_image", "cpu", "memory", "container_port", "subnet_ids", "security_group_ids", "aws_region", "tags"],
    optional: ["desired_count", "environment_variables"],
    defaults: { desired_count: 1 },
    fieldTypes: {
      name: "string",
      project: "string",
      environment: "string",
      request_id: "string",
      cluster_arn: "string",
      container_image: "string",
      cpu: "number",
      memory: "number",
      container_port: "number",
      subnet_ids: "list",
      security_group_ids: "list",
      aws_region: "string",
      desired_count: "number",
      environment_variables: "map",
      tags: "map",
    },
    strip: [],
    compute: (config, ctx) => {
      const nameFromConfig = typeof config.name === "string" && config.name.trim() ? config.name.trim() : undefined
      const name = nameFromConfig ?? `req-${ctx.requestId.toLowerCase()}`
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        name,
        project: ctx.project,
        environment: ctx.environment,
        request_id: ctx.requestId,
        tags: {
          ManagedBy: "tfpilot",
          TfPilotRequestId: ctx.requestId,
          Project: ctx.project,
          Environment: ctx.environment,
          ...userTags,
        },
      }
    },
  },
  {
    type: "iam-role-app",
    category: "iam",
    description: "Application IAM role",
    required: ["name", "project", "environment", "request_id", "assume_role_policy_json"],
    optional: ["inline_policies", "managed_policy_arns", "tags"],
    defaults: {},
    fieldTypes: {
      name: "string",
      project: "string",
      environment: "string",
      request_id: "string",
      assume_role_policy_json: "string",
      inline_policies: "map",
      managed_policy_arns: "list",
      tags: "map",
    },
    strip: [],
    compute: (config, ctx) => {
      const nameFromConfig = typeof config.name === "string" && config.name.trim() ? config.name.trim() : undefined
      const name = nameFromConfig ?? `req-${ctx.requestId.toLowerCase()}`
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        name,
        project: ctx.project,
        environment: ctx.environment,
        request_id: ctx.requestId,
        tags: {
          ManagedBy: "tfpilot",
          TfPilotRequestId: ctx.requestId,
          Project: ctx.project,
          Environment: ctx.environment,
          ...userTags,
        },
      }
    },
  },
]
