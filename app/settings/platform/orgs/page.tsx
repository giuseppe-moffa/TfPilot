import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { getUserRole } from "@/lib/auth/roles"
import PlatformOrgsClient from "./PlatformOrgsClient"

/**
 * Platform orgs management: platform-admin only.
 * Same gating as admin APIs (getUserRole === "admin").
 */
export default async function PlatformOrgsPage() {
  const session = await getSessionFromCookies()
  if (!session) notFound()
  const role = getUserRole(session.login)
  if (role !== "admin") notFound()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Platform Orgs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View and create organizations on the platform.
        </p>
      </div>
      <PlatformOrgsClient />
    </div>
  )
}
