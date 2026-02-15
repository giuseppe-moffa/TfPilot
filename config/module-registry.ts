export type FieldType = "string" | "number" | "boolean" | "map" | "list" | "enum"

export type ModuleField = {
  name: string
  type: FieldType
  required?: boolean
  default?: unknown
  description?: string
  enum?: string[]
  immutable?: boolean
  readOnly?: boolean
  sensitive?: boolean
  risk_level?: "low" | "medium" | "high"
  category?: string
}

export type ModuleRegistryEntry = {
  type: string
  category?: string
  description?: string
  compute?: (config: Record<string, unknown>, ctx: { requestId: string; project: string; environment: string }) => Record<string, unknown>
  fields: ModuleField[]
}

export const moduleRegistry: ModuleRegistryEntry[] = [
  {
    type: "s3-bucket",
    category: "storage",
    description: "S3 bucket",
    compute: (config, ctx) => {
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        ...config,
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
    fields: [
      {
        name: "name",
        type: "string",
        required: true,
        immutable: true,
        readOnly: true,
        description: "Logical resource name (used for tagging and derived names)",
      },
      {
        name: "project",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Project identifier",
      },
      {
        name: "environment",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Environment identifier",
      },
      {
        name: "request_id",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Request correlation id",
      },
      {
        name: "bucket_name",
        type: "string",
        required: true,
        description: "Bucket name (must be globally unique)",
        immutable: true,
      },
      {
        name: "versioning_enabled",
        type: "boolean",
        required: false,
        default: true,
        description: "Enable S3 versioning",
      },
      {
        name: "force_destroy",
        type: "boolean",
        required: false,
        default: false,
        description: "Allow bucket deletion with objects present",
        risk_level: "high",
        category: "advanced",
      },
      {
        name: "kms_key_arn",
        type: "string",
        required: false,
        description: "KMS key ARN for SSE-KMS encryption",
        sensitive: true,
        category: "advanced",
      },
      {
        name: "block_public_access",
        type: "boolean",
        required: false,
        default: true,
        description: "Block public ACLs and bucket policies",
        risk_level: "high",
      },
      {
        name: "enable_lifecycle",
        type: "boolean",
        required: false,
        default: false,
        description: "Enable default lifecycle configuration",
        category: "advanced",
      },
      {
        name: "noncurrent_expiration_days",
        type: "number",
        required: false,
        default: 30,
        description: "Expire noncurrent object versions after N days",
        category: "advanced",
      },
      {
        name: "abort_multipart_days",
        type: "number",
        required: false,
        default: 7,
        description: "Abort incomplete multipart uploads after N days",
        category: "advanced",
      },
      {
        name: "encryption_mode",
        type: "enum",
        required: false,
        default: "sse-s3",
        enum: ["sse-s3", "sse-kms-aws-managed", "sse-kms-cmk"],
        description: "Server-side encryption: SSE-S3 (AES256), AWS-managed KMS, or customer-managed KMS",
      },
      {
        name: "tags",
        type: "map",
        required: true,
        description: "Resource tags",
      },
    ],
  },
  {
    type: "sqs-queue",
    category: "messaging",
    description: "SQS queue",
    compute: (config, ctx) => {
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        ...config,
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
    fields: [
      { name: "name", type: "string", required: true, immutable: true, description: "Queue logical name" },
      { name: "project", type: "string", required: true, readOnly: true, immutable: true, description: "Project identifier" },
      {
        name: "environment",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Environment identifier",
      },
      {
        name: "request_id",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Request correlation id",
      },
      { name: "fifo", type: "boolean", default: false, description: "Use FIFO queue", required: false },
      { name: "dlq_enabled", type: "boolean", default: true, description: "Enable dead-letter queue", required: false },
      { name: "max_receive_count", type: "number", default: 5, description: "DLQ max receive count", required: false },
      {
        name: "message_retention_seconds",
        type: "number",
        default: 345600,
        description: "Primary queue retention (seconds)",
        required: false,
      },
      {
        name: "dlq_message_retention_seconds",
        type: "number",
        default: 1209600,
        description: "DLQ retention (seconds)",
        required: false,
      },
      { name: "visibility_timeout_seconds", type: "number", default: 30, description: "Visibility timeout (seconds)", required: false },
      { name: "receive_wait_time_seconds", type: "number", default: 20, description: "Long polling wait time (seconds)", required: false },
      { name: "kms_key_id", type: "string", description: "KMS key id for SSE", sensitive: true, required: false, category: "advanced" },
      { name: "tags", type: "map", required: true, description: "Resource tags" },
    ],
  },
  {
    type: "ecs-service",
    category: "compute",
    description: "ECS service",
    compute: (config, ctx) => {
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        ...config,
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
    fields: [
      { name: "name", type: "string", required: true, immutable: true, description: "Service logical name" },
      { name: "project", type: "string", required: true, readOnly: true, immutable: true, description: "Project identifier" },
      {
        name: "environment",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Environment identifier",
      },
      {
        name: "request_id",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Request correlation id",
      },
      { name: "cluster_arn", type: "string", required: true, description: "ECS cluster ARN" },
      { name: "container_image", type: "string", required: true, description: "Container image" },
      { name: "cpu", type: "number", required: true, description: "Task CPU units" },
      { name: "memory", type: "number", required: true, description: "Task memory (MB)" },
      { name: "container_port", type: "number", required: true, description: "Container port" },
      { name: "subnet_ids", type: "list", required: true, description: "Subnet IDs for tasks" },
      { name: "security_group_ids", type: "list", required: true, description: "Security group IDs" },
      { name: "aws_region", type: "string", required: true, description: "AWS region" },
      { name: "desired_count", type: "number", required: false, default: 1, description: "Desired task count" },
      { name: "environment_variables", type: "map", required: false, description: "Environment variables", category: "advanced" },
      { name: "tags", type: "map", required: true, description: "Resource tags" },
    ],
  },
  {
    type: "iam-role-app",
    category: "iam",
    description: "Application IAM role",
    compute: (config, ctx) => {
      const userTags =
        config.tags && typeof config.tags === "object" && !Array.isArray(config.tags) ? (config.tags as Record<string, string>) : {}
      return {
        ...config,
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
    fields: [
      { name: "name", type: "string", required: true, immutable: true, description: "Role name" },
      { name: "project", type: "string", required: true, readOnly: true, immutable: true, description: "Project identifier" },
      {
        name: "environment",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Environment identifier",
      },
      {
        name: "request_id",
        type: "string",
        required: true,
        readOnly: true,
        immutable: true,
        description: "Request correlation id",
      },
      { name: "assume_role_policy_json", type: "string", required: true, description: "Assume role policy JSON" },
      { name: "inline_policies", type: "map", required: false, description: "Inline policies", category: "advanced" },
      { name: "managed_policy_arns", type: "list", required: false, description: "Attached managed policies", category: "advanced" },
      { name: "tags", type: "map", required: false, description: "Resource tags" },
    ],
  },
]
