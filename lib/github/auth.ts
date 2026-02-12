import { NextRequest } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"

export async function getGitHubAccessToken(req?: NextRequest) {
  const cookieStore = req ? req.cookies : undefined
  const session = await getSessionFromCookies(cookieStore as any)
  const token = session?.accessToken
  if (!token) {
    return null
  }
  return token
}
