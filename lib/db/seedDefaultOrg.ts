/**
 * Seed default org and org memberships from TFPILOT_ADMINS / TFPILOT_APPROVERS.
 * Idempotent: safe to run multiple times. Admin wins over approver when login in both.
 */

import { withClient } from "@/lib/db/pg"

const DEFAULT_ORG_ID = "default"
const DEFAULT_ORG_SLUG = "tfpilot"
const DEFAULT_ORG_NAME = "TfPilot"

function isPlaceholder(value: string): boolean {
  return value.startsWith("__BUILD_PLACEHOLDER_")
}

function normalizeLogins(raw: string[]): string[] {
  return raw
    .filter((l): l is string => typeof l === "string" && !!l.trim() && !isPlaceholder(l))
    .map((l) => l.trim())
}

/**
 * Build membership list from admin and approver logins. Admin wins when in both.
 */
export function buildMembershipList(admins: string[], approvers: string[]): { login: string; role: string }[] {
  const adminList = normalizeLogins(admins)
  const approverList = normalizeLogins(approvers)
  const adminSet = new Set(adminList)
  const result: { login: string; role: string }[] = []
  for (const login of adminList) {
    result.push({ login, role: "admin" })
  }
  for (const login of approverList) {
    if (!adminSet.has(login)) {
      result.push({ login, role: "approver" })
    }
  }
  return result
}

export type SeedDefaultOrgResult = {
  ok: true
  orgInserted: boolean
  membershipsUpserted: number
} | {
  ok: false
  error: string
}

const ORG_UPSERT_SQL = `
INSERT INTO orgs (id, slug, name, created_at, updated_at)
VALUES ($1, $2, $3, $4, $4)
ON CONFLICT (id) DO NOTHING
`

const MEMBERSHIP_UPSERT_SQL = `
INSERT INTO org_memberships (org_id, login, role, created_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (org_id, login) DO UPDATE SET role = EXCLUDED.role
`

/**
 * Seed default org and memberships. Idempotent.
 * @param admins - GitHub logins for admin role (e.g. from TFPILOT_ADMINS)
 * @param approvers - GitHub logins for approver role (e.g. from TFPILOT_APPROVERS). Admin wins when in both.
 * @returns result or { ok: false, error } if DB not configured or query fails.
 */
export async function seedDefaultOrg(
  admins: string[],
  approvers: string[]
): Promise<SeedDefaultOrgResult> {
  const result = await withClient(async (client) => {
    const now = new Date().toISOString()
    const orgResult = await client.query(ORG_UPSERT_SQL, [
      DEFAULT_ORG_ID,
      DEFAULT_ORG_SLUG,
      DEFAULT_ORG_NAME,
      now,
    ])
    const orgInserted = (orgResult.rowCount ?? 0) > 0

    const memberships = buildMembershipList(admins, approvers)
    let membershipsUpserted = 0
    for (const { login, role } of memberships) {
      await client.query(MEMBERSHIP_UPSERT_SQL, [
        DEFAULT_ORG_ID,
        login,
        role,
        now,
      ])
      membershipsUpserted++
    }

    return { ok: true as const, orgInserted, membershipsUpserted }
  })

  if (result === null) {
    return { ok: false, error: "Database not configured" }
  }
  return result
}
