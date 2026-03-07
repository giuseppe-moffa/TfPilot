import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { isPlatformAdmin } from "@/lib/db/platformAdmins"
import PlatformOrgDetailClient from "./PlatformOrgDetailClient"

/**
 * Platform org detail: platform-admin only.
 */
export default async function PlatformOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const session = await getSessionFromCookies()
  if (!session) notFound()
  const ok = await isPlatformAdmin(session.login)
  if (!ok) notFound()

  const { orgId } = await params

  return (
    <div className="space-y-6">
      <PlatformOrgDetailClient orgId={orgId} />
    </div>
  )
}
