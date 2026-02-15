import { env } from "@/lib/config/env"

export type UserRole = "viewer" | "developer" | "approver" | "admin"

export function getUserRole(login?: string | null): UserRole {
  if (!login) return "viewer"
  if (env.TFPILOT_ADMINS.includes(login)) return "admin"
  if (env.TFPILOT_APPROVERS.includes(login)) return "approver"
  return "developer"
}
