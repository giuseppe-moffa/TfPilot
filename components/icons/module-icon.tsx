"use client"

import {
  Container,
  Database,
  Key,
  LineChart,
  Package,
  Server,
  type LucideIcon,
} from "lucide-react"

const MODULE_ICON_MAP: Record<string, LucideIcon> = {
  "ec2-instance": Server,
  "s3-bucket": Database,
  "ecr-repo": Container,
  "iam-role": Key,
  "cloudwatch-log-group": LineChart,
}

/**
 * Returns the icon component for a Terraform module.
 * Uses normalized module identifier (lowercase) for lookup.
 * Fallback: Package icon.
 */
export function getModuleIcon(module: string): LucideIcon {
  const key = (module ?? "").trim().toLowerCase()
  return MODULE_ICON_MAP[key] ?? Package
}

/**
 * Renders an icon + module label for use in tags, badges, and table cells.
 * Parent should use: inline-flex items-center gap-1 (or gap-1.5)
 * Icon: 12px, inherits text color.
 */
export function ModuleTag({ module }: { module: string }) {
  const Icon = getModuleIcon(module)
  return (
    <>
      <Icon className="size-3 shrink-0 text-current" strokeWidth={2} />
      <span>{module || "—"}</span>
    </>
  )
}
