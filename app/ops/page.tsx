import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { OpsDashboard } from "./OpsDashboard"

/**
 * Ops dashboard: admin-only. Same gating as template admin (404 for non-admins).
 */
export default async function OpsPage() {
  const session = await getSessionFromCookies()
  const email = session?.email ?? null
  if (
    !email ||
    !env.TFPILOT_ADMIN_EMAILS?.length ||
    !env.TFPILOT_ADMIN_EMAILS.includes(email)
  ) {
    notFound()
  }
  return <OpsDashboard />
}
