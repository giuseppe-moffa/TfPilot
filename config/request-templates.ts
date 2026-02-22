/**
 * Request templates: environment + module (moduleKey) + default config.
 * Project is resolved at request time from user selection (Environment step 1);
 * repo/PR targeting uses that project.
 */

export type RequestTemplate = {
  id: string
  label: string
  description?: string
  /** e.g. ec2-instance; empty for Blank template */
  moduleKey: string
  environment: string
  /** When true, environment is locked (e.g. prod) */
  lockEnvironment?: boolean
  /** When true, Step 2 shows editable Project + Environment selectors (e.g. Blank template) */
  allowCustomProjectEnv?: boolean
  /** Partial config merged over module field defaults */
  defaultConfig: Record<string, unknown>
}

export const requestTemplates: RequestTemplate[] = [
  {
    id: "blank",
    label: "Blank template",
    description: "Start from scratch",
    moduleKey: "",
    environment: "",
    allowCustomProjectEnv: true,
    defaultConfig: {},
  },
  {
    id: "dev-compute",
    label: "Dev Compute",
    description: "EC2 instance for dev; default t3.micro, no public IP, monitoring on",
    moduleKey: "ec2-instance",
    environment: "dev",
    lockEnvironment: false,
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
    moduleKey: "ec2-instance",
    environment: "prod",
    lockEnvironment: true,
    defaultConfig: {
      network_preset: "shared-public",
      instance_type: "m6i.large",
      associate_public_ip_address: false,
      root_volume_size_gb: 20,
      monitoring: true,
    },
  },
  {
    id: "s3-private-secure",
    label: "Private S3 Bucket (secure)",
    description: "Secure bucket with versioning and encryption enabled.",
    moduleKey: "s3-bucket",
    environment: "dev",
    defaultConfig: {
      versioning_enabled: true,
      force_destroy: false,
      encryption_mode: "sse-s3",
    },
  },
  {
    id: "s3-public-assets",
    label: "Public S3 Bucket (assets)",
    description: "Bucket for static assets. Versioning off and force destroy enabled for easier cleanup.",
    moduleKey: "s3-bucket",
    environment: "dev",
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
    moduleKey: "ecr-repo",
    environment: "dev",
    defaultConfig: {
      scan_on_push: true,
      retain_images: 5,
      force_delete: false,
      image_tag_mutability: "IMMUTABLE",
    },
  },
]

export function getRequestTemplate(id: string): RequestTemplate | undefined {
  return requestTemplates.find((t) => t.id === id)
}

export function getTemplatesForModule(moduleKey: string): RequestTemplate[] {
  return requestTemplates.filter((t) => t.moduleKey === moduleKey)
}
