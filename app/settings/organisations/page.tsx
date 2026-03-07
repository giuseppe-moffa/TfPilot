import { notFound } from "next/navigation"
import { getSessionFromCookies } from "@/lib/auth/session"
import { isPlatformAdmin } from "@/lib/db/platformAdmins"
import PlatformOrgsClient from "./PlatformOrgsClient"

/**
 * Platform orgs management: platform-admin only.
 */
export default async function PlatformOrgsPage() {
  const session = await getSessionFromCookies()
  if (!session) notFound()
  const ok = await isPlatformAdmin(session.login)
  if (!ok) notFound()

  return <PlatformOrgsClient />
}
