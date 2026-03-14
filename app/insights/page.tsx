import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { isPlatformAdmin } from "@/lib/db/platformAdmins"
import { InsightsDashboard } from "./InsightsDashboard"

/**
 * Insights dashboard: platform admin only (404 for non-admins).
 */
export default async function InsightsPage() {
  const session = await getSessionFromCookies()
  const login = session?.login ?? null
  if (!login || !(await isPlatformAdmin(login))) {
    notFound()
  }
  return <InsightsDashboard />
}
