import type { CreateTemplatePayload } from "./templates-store"

/**
 * Legacy default templates (pre-S3 catalogue). Used by the seed API to migrate
 * them into the tfpilot-templates bucket. Each entry has a fixed id for migration.
 */
export type SeedTemplate = CreateTemplatePayload & { id: string }

export const DEFAULT_SEED_TEMPLATES: SeedTemplate[] = [
  {
    id: "dev-compute",
    label: "Dev Compute",
    description: "EC2 instance for dev; default t3.micro, no public IP, monitoring on",
    project: "",
    environment: "dev",
    module: "ec2-instance",
    lockEnvironment: false,
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      network_preset: "shared-public",
      instance_type: "t3.micro",
      associate_public_ip_address: false,
      root_volume_size_gb: 20,
      monitoring: true,
    },
  },
  {
    id: "prod-compute",
    label: "Prod Compute",
    description: "EC2 instance for prod; default m6i.large, no public IP, monitoring on",
    project: "",
    environment: "prod",
    module: "ec2-instance",
    lockEnvironment: true,
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      network_preset: "shared-public",
      instance_type: "m6i.large",
      associate_public_ip_address: false,
      root_volume_size_gb: 20,
      monitoring: true,
    },
  },
  {
    id: "dev-frontend",
    label: "Dev Frontend",
    description: "EC2 instance for dev frontend/app; t3.micro, public IP for easy access, monitoring on",
    project: "",
    environment: "dev",
    module: "ec2-instance",
    lockEnvironment: false,
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      network_preset: "shared-public",
      instance_type: "t3.micro",
      associate_public_ip_address: true,
      root_volume_size_gb: 20,
      monitoring: true,
    },
  },
  {
    id: "prod-frontend",
    label: "Prod Frontend",
    description: "EC2 instance for prod frontend/app; t3.medium, no public IP (use ALB/CDN), monitoring on",
    project: "",
    environment: "prod",
    module: "ec2-instance",
    lockEnvironment: true,
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      network_preset: "shared-public",
      instance_type: "t3.medium",
      associate_public_ip_address: false,
      root_volume_size_gb: 20,
      monitoring: true,
    },
  },
  {
    id: "s3-private-secure",
    label: "Private S3 Bucket (secure)",
    description: "Secure bucket with versioning and encryption enabled.",
    project: "",
    environment: "dev",
    module: "s3-bucket",
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      versioning_enabled: true,
      force_destroy: false,
      encryption_mode: "sse-s3",
    },
  },
  {
    id: "s3-public-assets",
    label: "Public S3 Bucket (assets)",
    description:
      "Bucket for static assets. Versioning off and force destroy enabled for easier cleanup.",
    project: "",
    environment: "dev",
    module: "s3-bucket",
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      versioning_enabled: false,
      force_destroy: true,
      encryption_mode: "sse-s3",
    },
  },
  {
    id: "ecr-repository",
    label: "ECR Repository",
    description: "Container registry with image scanning, lifecycle policy, and immutable tags.",
    project: "",
    environment: "dev",
    module: "ecr-repo",
    allowCustomProjectEnv: true,
    enabled: true,
    defaultConfig: {
      scan_on_push: true,
      retain_images: 5,
      force_delete: false,
      image_tag_mutability: "IMMUTABLE",
    },
  },
]
