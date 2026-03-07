import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole } from "@/lib/auth/roles"
import PlatformOrgDetailClient from "./PlatformOrgDetailClient"

/**
 * Platform org detail: platform-admin only.
 * Same gating as Platform Orgs list page.
 */
export default async function PlatformOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const session = await getSessionFromCookies()
  if (!session) notFound()
  const role = getUserRole(session.login)
  if (role !== "admin") notFound()

  const { orgId } = await params

  return (
    <div className="space-y-6">
      <PlatformOrgDetailClient orgId={orgId} />
    </div>
  )
}
