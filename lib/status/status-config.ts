/**
 * Single source of truth for status display across Timeline and Requests Table.
 * Canonical statuses only; backend variants are normalized via normalizeRequestStatus.
 */

export const CANONICAL_STATUSES = [
  "request_created",
  "planning",
  "plan_ready",
  "approved",
  "merged",
  "applying",
  "applied",
  "destroying",
  "destroyed",
  "failed",
] as const

export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number]

export type StatusTone = "success" | "warning" | "info" | "destructive" | "muted"

export type StatusMeta = {
  key: CanonicalStatus
  label: string
  tone: StatusTone
  color: string
  isTerminal: boolean
  isActive: boolean
}

const STATUS_CONFIG: Record<CanonicalStatus, Omit<StatusMeta, "key">> = {
  request_created: {
    label: "Request created",
    tone: "info",
    color: "#3B82F6",
    isTerminal: false,
    isActive: false,
  },
  planning: {
    label: "Planning in progress",
    tone: "info",
    color: "#2563EB",
    isTerminal: false,
    isActive: true,
  },
  plan_ready: {
    label: "Plan ready",
    tone: "warning",
    color: "#F59E0B",
    isTerminal: false,
    isActive: false,
  },
  approved: {
    label: "Approved",
    tone: "info",
    color: "#8B5CF6",
    isTerminal: false,
    isActive: false,
  },
  merged: {
    label: "Pull request merged",
    tone: "info",
    color: "#6366F1",
    isTerminal: false,
    isActive: false,
  },
  applying: {
    label: "Deploying…",
    tone: "info",
    color: "#6366F1",
    isTerminal: false,
    isActive: true,
  },
  applied: {
    label: "Deployed",
    tone: "success",
    color: "#10B981",
    isTerminal: true,
    isActive: false,
  },
  destroying: {
    label: "Destroying",
    tone: "warning",
    color: "#F97316",
    isTerminal: false,
    isActive: true,
  },
  destroyed: {
    label: "Destroyed",
    tone: "muted",
    color: "#6B7280",
    isTerminal: true,
    isActive: false,
  },
  failed: {
    label: "Failed",
    tone: "destructive",
    color: "#EF4444",
    isTerminal: true,
    isActive: false,
  },
}

const FALLBACK_COLOR = "#8A94A6"

export function getStatusMeta(status: CanonicalStatus | string): StatusMeta {
  const key = status as CanonicalStatus
  const config = STATUS_CONFIG[key]
  if (config) {
    return { key, ...config }
  }
  return {
    key: "request_created",
    label: "Request created",
    tone: "info",
    color: FALLBACK_COLOR,
    isTerminal: false,
    isActive: false,
  }
}

export function isActiveStatus(status: CanonicalStatus | string): boolean {
  return getStatusMeta(status).isActive
}

export function getStatusColor(status: CanonicalStatus | string): string {
  return getStatusMeta(status).color
}

export function getStatusLabel(status: CanonicalStatus | string): string {
  return getStatusMeta(status).label
}

export function isTerminalStatus(status: CanonicalStatus | string): boolean {
  return getStatusMeta(status).isTerminal
}

/**
 * Maps backend/API status variants to canonical status for consistent UI.
 * Does not change request lifecycle or API contracts.
 */
export function normalizeRequestStatus(
  status: string | undefined,
  context?: { isDestroying?: boolean; isDestroyed?: boolean }
): CanonicalStatus {
  const s = status ?? "created"
  if (context?.isDestroyed) return "destroyed"
  if (context?.isDestroying) return "destroying"
  switch (s) {
    case "destroyed":
      return "destroyed"
    case "destroying":
      return "destroying"
    case "failed":
      return "failed"
    case "complete":
    case "applied":
      return "applied"
    case "merged":
      return "merged"
    case "applying":
    case "applying_changes":
      return "applying"
    case "approved":
    case "awaiting_approval":
      return "approved"
    case "plan_ready":
    case "planned":
      return "plan_ready"
    case "planning":
    case "pr_open":
    case "created":
    case "pending":
      return "planning"
    default:
      return "request_created"
  }
}
