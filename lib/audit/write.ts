/**
 * Audit write helper. Best-effort append-only. Never throws; logs on failure.
 */

import { randomBytes } from "node:crypto"
import type { AuditEventInput } from "./types"
import { query } from "@/lib/db/pg"
import { logWarn } from "@/lib/observability/logger"

export type AuditWriteDeps = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number } | null>
  generateId: () => string
  log: (event: string, error?: unknown, data?: Record<string, unknown>) => void
}

function defaultGenerateId(): string {
  return `audit_${randomBytes(12).toString("hex")}`
}

const INSERT_SQL = `
  INSERT INTO audit_events (id, org_id, actor_login, source, event_type, entity_type, entity_id, metadata, request_id, environment_id, project_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`

export type WriteAuditResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/**
 * Write an audit event. Best-effort: never throws. Logs and returns failure on error.
 * Callers should ignore the return value and never branch on it; continue normal flow regardless.
 */
export async function writeAuditEvent(
  deps: AuditWriteDeps,
  input: AuditEventInput
): Promise<WriteAuditResult> {
  const id = deps.generateId()
  const values = [
    id,
    input.org_id,
    input.actor_login ?? null,
    input.source,
    input.event_type,
    input.entity_type,
    input.entity_id,
    input.metadata ?? null,
    input.request_id ?? null,
    input.environment_id ?? null,
    input.project_key ?? null,
  ]

  try {
    const result = await deps.query(INSERT_SQL, values)
    if (result == null) {
      deps.log("audit.write.db_unavailable", undefined, {
        event_type: input.event_type,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        org_id: input.org_id,
      })
      return { ok: false, error: "Database not configured" }
    }
    return { ok: true, id }
  } catch (err) {
    deps.log("audit.write.failed", err, {
      event_type: input.event_type,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      org_id: input.org_id,
    })
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Production deps: real DB, id generator, logWarn. */
export const auditWriteDeps: AuditWriteDeps = {
  query,
  generateId: defaultGenerateId,
  log: logWarn,
}
