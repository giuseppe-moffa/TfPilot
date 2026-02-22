import { networkPresetIds } from "@/config/network-presets"

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
    type: "ec2-instance",
    category: "compute",
    description: "Single EC2 instance",
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
      { name: "name", type: "string", required: true, immutable: true, description: "Logical name for the EC2 instance" },
      { name: "project", type: "string", required: true, readOnly: true, immutable: true, description: "Project identifier" },
      { name: "environment", type: "string", required: true, readOnly: true, immutable: true, description: "Environment identifier" },
      { name: "request_id", type: "string", required: true, readOnly: true, immutable: true, description: "Request correlation id" },
      {
        name: "instance_type",
        type: "enum",
        required: true,
        enum: ["t2.micro", "t3.micro", "t3.small", "t3.medium", "t3.large", "m6i.large", "m6i.xlarge", "c6i.large", "c6i.xlarge"],
        description: "EC2 instance type (curated)",
      },
      {
        name: "network_preset",
        type: "enum",
        required: true,
        enum: networkPresetIds,
        description: "Network preset (VPC, subnet, security group)",
      },
      {
        name: "associate_public_ip_address",
        type: "boolean",
        required: false,
        default: false,
        description: "Whether to associate a public IP address",
      },
      {
        name: "root_volume_size_gb",
        type: "number",
        required: false,
        default: 20,
        description: "Root volume size in GB",
      },
      {
        name: "monitoring",
        type: "boolean",
        required: false,
        default: true,
        description: "Enable detailed (basic) CloudWatch monitoring",
      },
      { name: "tags", type: "map", required: true, description: "Resource tags" },
      {
        name: "subnet_id",
        type: "string",
        required: false,
        description: "Override: subnet ID (leave empty to use preset default)",
        category: "advanced",
      },
      {
        name: "security_group_ids",
        type: "list",
        required: false,
        description: "Override: security group IDs (leave empty to use preset default)",
        category: "advanced",
      },
      { name: "ami_id", type: "string", required: false, description: "AMI ID (omit if using ami_ssm_param)", category: "advanced" },
      {
        name: "ami_ssm_param",
        type: "string",
        required: false,
        description: "SSM parameter name for AMI (e.g. /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64)",
        category: "advanced",
      },
      { name: "key_name", type: "string", required: false, description: "Optional key pair name for SSH", category: "advanced" },
      {
        name: "subnet_type",
        type: "enum",
        required: false,
        enum: ["public", "private"],
        description: "Subnet type (public or private); used for reference or lookup",
        category: "advanced",
      },
    ],
  },
  {
    type: "ecr-repo",
    category: "container",
    description: "ECR repository with image scanning, lifecycle policy, and immutable tags",
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
      { name: "name", type: "string", required: true, immutable: true, readOnly: true, description: "Logical name for the repository" },
      { name: "project", type: "string", required: true, readOnly: true, immutable: true, description: "Project identifier" },
      { name: "environment", type: "string", required: true, readOnly: true, immutable: true, description: "Environment identifier" },
      { name: "request_id", type: "string", required: true, readOnly: true, immutable: true, description: "Request correlation id" },
      { name: "repo_name", type: "string", required: false, description: "Override ECR repository name (optional)" },
      { name: "scan_on_push", type: "boolean", required: false, default: true, description: "Enable image scanning on push" },
      { name: "retain_images", type: "number", required: false, default: 5, description: "Lifecycle policy: retain last N images (1–100)" },
      { name: "force_delete", type: "boolean", required: false, default: false, description: "Allow force delete when repo has images", category: "advanced", risk_level: "high" },
      { name: "image_tag_mutability", type: "enum", required: false, default: "IMMUTABLE", enum: ["MUTABLE", "IMMUTABLE"], description: "Image tag mutability", category: "advanced" },
      { name: "tags", type: "map", required: false, description: "Resource tags" },
    ],
  },
]
