/**
 * Audit type definitions for platform mutation events.
 * Append-only Postgres records. Typed layer to prevent event-type typos.
 */

export const AUDIT_SOURCES = ["user", "system", "github_webhook"] as const
export type AuditSource = (typeof AUDIT_SOURCES)[number]

export const AUDIT_EVENT_TYPES = [
  "org_created",
  "org_archived",
  "org_restored",
  "org_member_added",
  "org_member_removed",
  "team_created",
  "team_member_added",
  "team_member_removed",
  "project_access_granted",
  "project_access_revoked",
  "project_user_role_assigned",
  "project_user_role_removed",
  "request_created",
  "request_approved",
  "request_apply_dispatched",
  "request_destroy_dispatched",
  "environment_destroy_requested",
  "environment_deploy_pr_opened",
  "workspace_destroy_requested",
  "workspace_deploy_pr_opened",
] as const
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

export const AUDIT_ENTITY_TYPES = ["org", "team", "project", "request", "environment", "workspace"] as const
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

/** MVP-friendly metadata shape. Small JSON-like object for event context. Keep minimal (e.g. slug, name); avoid overstuffing. May widen when more event metadata arrives. */
export type AuditMetadata = {
  login?: string
  slug?: string
  name?: string
  team_id?: string
  team_slug?: string
  project_key?: string
  user_login?: string
  role?: string
  workspace_id?: string
  workspace_slug?: string
  module?: string
  pr_number?: number
}

/** Input for write helper before DB persistence. */
export type AuditEventInput = {
  org_id: string
  actor_login: string | null
  source: AuditSource
  event_type: AuditEventType
  entity_type: AuditEntityType
  entity_id: string
  metadata?: AuditMetadata | null
  request_id?: string | null
  workspace_id?: string | null
  project_key?: string | null
}

/** Persisted DB row shape. */
export type AuditEventRow = AuditEventInput & {
  id: string
  created_at: string
}
